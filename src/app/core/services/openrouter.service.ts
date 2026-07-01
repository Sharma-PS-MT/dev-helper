import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, map } from 'rxjs';
import { AuthConfigService } from './auth-config.service';

// ── Review item types supported by the UI ────────────────────────────────────
export type ReviewItemType = 'suggestion' | 'good' | 'risk';

export interface AIReviewItem {
  id: string;
  type: ReviewItemType;
  /** Short title / headline of the finding */
  title: string;
  /** Untruncated full title sentence for tooltips */
  fullTitle?: string;
  /** Concise explanation — already formatted for direct posting */
  body: string;
  /** Source file path extracted from the AI response, e.g. "src/foo/bar.ts" */
  filePath?: string;
  /** Line number or range within the file, e.g. "42" or "42-48" */
  lineNumber?: string;
  /** Original code snippet (before suggestion) */
  originalCode?: string;
  /** Suggested replacement code */
  suggestedCode?: string;
  /** Severity for risk items */
  severity?: 'info' | 'warn' | 'error';
}

@Injectable({ providedIn: 'root' })
export class OpenRouterService {
  constructor(private http: HttpClient, private authConfig: AuthConfigService) {}

  get isConfigured(): boolean {
    const c = this.authConfig.config();
    return !!(c.openaiBaseUrl && c.openaiApiKey && c.openaiModel);
  }

  get modelName(): string {
    return this.authConfig.config().openaiModel || '';
  }

  /**
   * Send a code review prompt to the OpenAI-compatible provider (via Python proxy).
   */
  reviewPR(systemPrompt: string, userPrompt: string): Observable<string> {
    const c = this.authConfig.config();

    if (!c.openaiBaseUrl || !c.openaiApiKey || !c.openaiModel) {
      return throwError(() => new Error('OpenAI compatible provider is not configured. Go to Settings → AI Config.'));
    }

    const payload = {
      base_url: c.openaiBaseUrl,
      api_key: c.openaiApiKey,
      model: c.openaiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: c.openaiMaxTokens || 4096,
    };

    return this.http.post<any>('/python-ai/openai/chat/completions', payload).pipe(
      map(res => {
        const choice = res?.choices?.[0];
        if (!choice) throw new Error('No response received from OpenAI compatible endpoint.');
        return choice.message?.content || choice.text || '';
      })
    );
  }

  /**
   * Parse the structured AI response into typed review items.
   *
   * Expected format from the AI (each item is a bullet under a ## section):
   *
   *   ## Inline Suggestions
   *   - **[src/foo/bar.ts:42]** Title of suggestion
   *     Explanation of why this change is needed.
   *     ```original
   *     const x = someOldCode();
   *     ```
   *     ```suggested
   *     const x = someNewCode();
   *     ```
   *
   *   ## Risks & Concerns
   *   - **[src/auth/guard.ts]** [ERROR] Potential security issue with X
   *     Detailed explanation of the risk.
   *
   *   ## Good Practices
   *   - Clear separation of concerns in the service layer
   */
  parseReviewItems(raw: string): AIReviewItem[] {
    const items: AIReviewItem[] = [];
    let currentType: ReviewItemType = 'suggestion';
    let itemIndex = 0;

    // Split into sections by ## headers
    const sections = raw.split(/^##\s+/m);

    for (const section of sections) {
      if (!section.trim()) continue;

      // Determine section type from the first line
      const firstLine = section.split('\n')[0].toLowerCase();
      if (firstLine.includes('suggest') || firstLine.includes('inline') || firstLine.includes('improvement')) {
        currentType = 'suggestion';
      } else if (firstLine.includes('risk') || firstLine.includes('concern') || firstLine.includes('issue') || firstLine.includes('problem')) {
        currentType = 'risk';
      } else if (firstLine.includes('good') || firstLine.includes('positiv') || firstLine.includes('prais') || firstLine.includes('well')) {
        currentType = 'good';
      }

      // Extract all top-level bullets (lines starting with "- " or "* ")
      const sectionBody = section.split('\n').slice(1).join('\n');
      // Split on top-level bullets (not indented sub-bullets)
      const bulletChunks = sectionBody.split(/\n(?=[-*] )/);

      for (const chunk of bulletChunks) {
        const trimmedChunk = chunk.trim();
        if (!trimmedChunk || (!trimmedChunk.startsWith('- ') && !trimmedChunk.startsWith('* '))) continue;

        // Remove leading bullet marker
        const content = trimmedChunk.replace(/^[-*]\s+/, '');
        if (!content.trim()) continue;

        // ── Extract filePath and lineNumber ──────────────────────────────────
        let filePath: string | undefined;
        let lineNumber: string | undefined;
        let remainingContent = content;

        // Pattern 1: **[src/foo/bar.ts:42]** rest
        const boldBracketLine = content.match(/^\*\*\[([^\]]+)\]\*\*[:\s]*([\s\S]*)/);
        if (boldBracketLine) {
          const fileRef = boldBracketLine[1].trim();
          remainingContent = boldBracketLine[2].trim();
          // Split file:line
          const colonIdx = fileRef.lastIndexOf(':');
          if (colonIdx > 0 && /^\d/.test(fileRef.substring(colonIdx + 1))) {
            filePath = fileRef.substring(0, colonIdx);
            lineNumber = fileRef.substring(colonIdx + 1);
          } else {
            filePath = fileRef;
          }
        } else {
          // Pattern 2: `filename.ext`: rest
          const backtick = content.match(/^`([^`]+\.[a-zA-Z]{1,10})`[:\s]*([\s\S]*)/);
          if (backtick) {
            filePath = backtick[1].trim();
            remainingContent = backtick[2].trim();
          } else {
            // Pattern 3: **FileName.ext**: rest (no brackets)
            const boldFile = content.match(/^\*\*([^*]+\.[a-zA-Z]{1,10})\*\*[:\s]*([\s\S]*)/);
            if (boldFile) {
              filePath = boldFile[1].trim();
              remainingContent = boldFile[2].trim();
            }
          }
        }

        // ── Extract severity tag for risks [ERROR], [WARN], [INFO] ──────────
        let severity: 'info' | 'warn' | 'error' = currentType === 'risk' ? 'warn' : 'info';
        const sevMatch = remainingContent.match(/^\[(ERROR|WARN|INFO|HIGH|MEDIUM|LOW)\]\s*/i);
        if (sevMatch) {
          const tag = sevMatch[1].toUpperCase();
          severity = (tag === 'ERROR' || tag === 'HIGH') ? 'error'
            : (tag === 'WARN' || tag === 'MEDIUM') ? 'warn'
            : 'info';
          remainingContent = remainingContent.replace(/^\[(ERROR|WARN|INFO|HIGH|MEDIUM|LOW)\]\s*/i, '');
        }

        // ── Extract fenced code blocks: ```original and ```suggested ─────────
        let originalCode: string | undefined;
        let suggestedCode: string | undefined;
        let bodyText = remainingContent;

        const origMatch = remainingContent.match(/```(?:original|before|old)[^\n]*\n([\s\S]*?)```/i);
        if (origMatch) {
          originalCode = origMatch[1].trim();
          bodyText = bodyText.replace(origMatch[0], '').trim();
        }

        const suggMatch = remainingContent.match(/```(?:suggested|after|new|replacement)[^\n]*\n([\s\S]*?)```/i);
        if (suggMatch) {
          suggestedCode = suggMatch[1].trim();
          bodyText = bodyText.replace(suggMatch[0], '').trim();
        }

        // Also remove any other code blocks from body (they've been captured above)
        bodyText = bodyText.replace(/```[\s\S]*?```/g, '').trim();

        // ── Derive title from first sentence of body ─────────────────────────
        const firstSentence = bodyText.split(/[.!?\n]/)[0].trim();
        const title = firstSentence.length > 90 ? firstSentence.substring(0, 87) + '…' : firstSentence;

        if (!title && !bodyText) continue;

        items.push({
          id: `item-${itemIndex++}`,
          type: currentType,
          title: title || bodyText.substring(0, 60),
          fullTitle: firstSentence || bodyText.substring(0, 300),
          body: bodyText,
          filePath,
          lineNumber,
          originalCode,
          suggestedCode,
          severity,
        });
      }
    }

    return items;
  }
}
