import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { BitbucketProject, BitbucketRepo, PRAnalysis, BitbucketPR } from '../../core/models/bitbucket.models';
import { TicketBadgeComponent } from '../../shared/components/ticket-badge/ticket-badge.component';
import { OpenRouterService, AIReviewItem } from '../../core/services/openrouter.service';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** A review item enriched with posting state and UI state */
export interface ReviewItem {
  id: string;
  item: AIReviewItem;
  posting: boolean;
  posted: boolean;
  error: string;
  showDiff: boolean;
}

@Component({
  selector: 'app-pr-review',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MatCardModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatProgressSpinnerModule, MatPaginatorModule,
    MatTooltipModule, MatDividerModule, TicketBadgeComponent,
  ],
  templateUrl: './pr-review.component.html',
  styleUrls: ['./pr-review.component.scss'],
})
export class PrReviewComponent implements OnInit {
  projects = signal<BitbucketProject[]>([]);
  repos = signal<BitbucketRepo[]>([]);

  selectedProject = signal<string | null>(null);
  selectedRepo = signal<string | null>(null);
  prInput = signal<string>('');

  projectSearch = signal('');
  repoSearch = signal('');

  filteredProjects = computed(() => {
    const t = this.projectSearch().toLowerCase();
    return this.projects().filter(p => (p.name || '').toLowerCase().includes(t) || (p.key || '').toLowerCase().includes(t));
  });

  filteredRepos = computed(() => {
    const t = this.repoSearch().toLowerCase();
    return this.repos().filter(r => (r.name || '').toLowerCase().includes(t) || (r.slug || '').toLowerCase().includes(t));
  });

  loadingProjects = signal(false);
  loadingRepos = signal(false);
  analyzing = signal(false);

  openPRs = signal<BitbucketPR[]>([]);
  loadingPRs = signal(false);

  // AI Review state
  aiReviewing = signal(false);
  aiReviewDone = signal(false);
  aiProvider = signal<'openrouter' | null>(null);
  aiModelName = signal<string>('');
  aiItems = signal<ReviewItem[]>([]);
  aiRawText = signal<string>('');
  aiError = signal<string>('');
  expandedItems = signal<Set<string>>(new Set());

  // Active tab in AI Review panel
  activeTab = signal<'suggestions' | 'risks' | 'good'>('suggestions');

  // Group view by type
  suggestionItems = computed(() => this.aiItems().filter(r => r.item.type === 'suggestion'));
  riskItems       = computed(() => this.aiItems().filter(r => r.item.type === 'risk'));
  goodItems       = computed(() => this.aiItems().filter(r => r.item.type === 'good'));

  result = signal<PRAnalysis | null>(null);

  pageSize = signal(50);
  pageIndex = signal(0);

  paginatedCommits = computed(() => {
    const res = this.result();
    if (!res) return [];
    const start = this.pageIndex() * this.pageSize();
    return res.commits.slice(start, start + this.pageSize());
  });

  constructor(
    private bitbucket: BitbucketService,
    private notify: NotificationService,
    public openRouter: OpenRouterService
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loadingProjects.set(true);
    this.bitbucket.getProjects().subscribe({
      next: px => { this.projects.set(px); this.loadingProjects.set(false); },
      error: () => { this.notify.error('Failed to load projects'); this.loadingProjects.set(false); }
    });
  }

  onProjectChange(key: string): void {
    this.selectedProject.set(key);
    this.selectedRepo.set(null);
    this.openPRs.set([]);
    this.loadingRepos.set(true);
    this.bitbucket.getRepositories(key).subscribe({
      next: rx => { this.repos.set(rx); this.loadingRepos.set(false); },
      error: () => { this.notify.error('Failed to load repos'); this.loadingRepos.set(false); }
    });
  }

  onRepoChange(slug: string): void {
    this.selectedRepo.set(slug);
    this.loadingPRs.set(true);
    this.openPRs.set([]);

    const proj = this.selectedProject() || undefined;
    this.bitbucket.getOpenPullRequests(slug, proj).subscribe({
      next: prs => {
        this.openPRs.set(prs);
        this.loadingPRs.set(false);
      },
      error: () => this.loadingPRs.set(false)
    });
  }

  selectAndAnalyzePR(prId: number): void {
    this.prInput.set(prId.toString());
    this.analyze();
  }

  // ─── AI Review ────────────────────────────────────────────────────────────────

  initiateAIReview(): void {
    const data = this.result();
    if (!data) return;

    this.aiReviewing.set(true);
    this.aiReviewDone.set(false);
    this.aiError.set('');
    this.aiItems.set([]);
    this.aiRawText.set('');
    this.expandedItems.set(new Set());
    this.activeTab.set('suggestions');

    const repoSlug = this.selectedRepo()!;
    const prId = data.pr.id;
    const projKey = this.selectedProject() || undefined;

    // Fetch diff alongside review (diff may fail — it's best-effort)
    const diff$ = this.bitbucket.getPRDiff(repoSlug, prId, projKey).pipe(
      catchError(() => of(''))
    );

    diff$.subscribe(diffText => {
      const prompt = this.buildPrompt(data, diffText);
      this.runAIReview(prompt);
    });
  }

  private buildPrompt(data: PRAnalysis, diffText: string): string {
    const systemPrompt = `You are an expert Senior Software Engineer doing a Pull Request code review, inspired by PR-Agent (Qodo) style.

Your task: produce a concise, actionable code review using EXACTLY these 3 sections and no others.

## Inline Suggestions
List specific code improvement suggestions — one per bullet. Use this format for each suggestion:

- **[path/to/file.ext:lineNumber]** Short title of the suggestion.
  Full explanation of what should be changed and why (1-3 sentences).
  \`\`\`original
  // paste the original code snippet here (3-10 lines)
  \`\`\`
  \`\`\`suggested
  // paste the improved code snippet here (3-10 lines)
  \`\`\`

If no code diff is available, omit the code blocks.
If no inline suggestions, write: - No inline suggestions.

## Risks & Concerns
List bugs, security issues, or architectural problems — one per bullet. Include severity tag.
- **[path/to/file.ext]** [ERROR|WARN|INFO] Short title. Description of the risk. (Omit file if it's a general concern.)

If no risks, write: - No risks identified.

## Good Practices
Briefly acknowledge what was done well — one per bullet.
- Description of the good practice.

If nothing stands out, write: - Standard implementation.

Rules:
- Each suggestion MUST include original and suggested code blocks when diff is available.
- Be specific about file paths and line numbers when possible.
- Comments posted to Bitbucket must be polite, constructive, and professional.
- Do not include a Summary section or any other sections.`;

    let userPrompt = `**PR Title:** ${data.pr.title}\n`;
    userPrompt += `**Author:** ${data.pr.author.display_name}\n`;
    userPrompt += `**Branch:** \`${data.pr.source.branch.name}\` → \`${data.pr.destination.branch.name}\`\n`;
    userPrompt += `**Description:** ${data.pr.description || 'No description provided'}\n\n`;

    userPrompt += `**Gap Analysis:**\n`;
    if (data.gaps.length === 0) {
      userPrompt += `- No gaps found\n`;
    } else {
      data.gaps.forEach(g => userPrompt += `- [${g.severity.toUpperCase()}] ${g.message}${g.detail ? ` — ${g.detail}` : ''}\n`);
    }

    userPrompt += `\n**Commits (${data.commits.length} total):**\n`;
    data.commits.slice(0, 30).forEach(c => {
      userPrompt += `- \`${c.hash.substring(0, 7)}\` ${c.message.split('\n')[0]}\n`;
    });

    if (diffText && diffText.length > 100) {
      // Truncate diff to ~8000 chars to stay within token limits
      const truncated = diffText.length > 8000
        ? diffText.substring(0, 8000) + '\n\n... [diff truncated for token limits]'
        : diffText;
      userPrompt += `\n**Code Diff:**\n\`\`\`diff\n${truncated}\n\`\`\``;
    }

    return JSON.stringify({ system: systemPrompt, user: userPrompt });
  }

  private runAIReview(promptJson: string): void {
    const { system, user } = JSON.parse(promptJson);

    if (!this.openRouter.isConfigured) {
      this.aiReviewing.set(false);
      this.aiError.set('OpenRouter is not configured. Go to Settings → AI Config, enter your API key, connect and select a free model.');
      this.notify.error('OpenRouter not configured. Check Settings → AI Config.');
      return;
    }

    this.aiProvider.set('openrouter');
    this.aiModelName.set(this.openRouter.modelName);

    this.openRouter.reviewPR(system, user).subscribe({
      next: text => this.finalizeReview(text),
      error: err => {
        this.aiReviewing.set(false);
        this.aiError.set(err.message || 'OpenRouter request failed. Check your API key and model selection.');
        this.notify.error('AI Review failed. Check Settings → AI Config.');
      }
    });
  }

  private finalizeReview(text: string): void {
    this.aiRawText.set(text);
    const parsed = this.openRouter.parseReviewItems(text);
    const items: ReviewItem[] = parsed.map(item => ({
      id: item.id,
      item,
      posting: false,
      posted: false,
      error: '',
      showDiff: false,
    }));
    this.aiItems.set(items);
    this.aiProvider.set('openrouter');
    this.aiReviewing.set(false);
    this.aiReviewDone.set(true);

    // Auto-select first tab that has items
    if (items.some(i => i.item.type === 'suggestion')) this.activeTab.set('suggestions');
    else if (items.some(i => i.item.type === 'risk')) this.activeTab.set('risks');
    else this.activeTab.set('good');
  }

  toggleItem(id: string): void {
    const s = new Set(this.expandedItems());
    s.has(id) ? s.delete(id) : s.add(id);
    this.expandedItems.set(s);
  }

  isItemExpanded(id: string): boolean {
    return this.expandedItems().has(id);
  }

  toggleDiff(ri: ReviewItem): void {
    this.aiItems.update(items =>
      items.map(s => s.id === ri.id ? { ...s, showDiff: !s.showDiff } : s)
    );
  }
  // ─── Post Comment to Bitbucket ────────────────────────────────────────────
  postComment(ri: ReviewItem): void {
    const data = this.result();
    if (!data) return;
    const repoSlug = this.selectedRepo()!;
    const prId = data.pr.id;
    const projKey = this.selectedProject() || undefined;
    // Build a short, polite, professional comment body
    const fileRef = ri.item.filePath ? `\`${ri.item.filePath}${ri.item.lineNumber ? ':' + ri.item.lineNumber : ''}\`` : 'this PR';
    const typeLabel = ri.item.type === 'suggestion' ? '💡 Suggestion'
      : ri.item.type === 'risk' ? '⚠️ Concern'
      : '✅ Good Practice';
    let commentText =
      `**${typeLabel}** *(via AI Code Review — ${this.aiModelName()})*\n\n` +
      (ri.item.filePath ? `**File:** ${fileRef}\n\n` : '') +
      ri.item.body;
    // Add code blocks to comment if available
    if (ri.item.originalCode || ri.item.suggestedCode) {
      if (ri.item.originalCode) {
        commentText += `\n\n**Original:**\n\`\`\`\n${ri.item.originalCode}\n\`\`\``;
      }
      if (ri.item.suggestedCode) {
        commentText += `\n\n**Suggested:**\n\`\`\`\n${ri.item.suggestedCode}\n\`\`\``;
      }
    }
    // Parse lineNumber string (e.g. "42" or "42-48") → first integer for the anchor
    let lineNum: number | undefined;
    if (ri.item.lineNumber) {
      const firstPart = ri.item.lineNumber.split(/[-–]/)[0].trim();
      const parsed = parseInt(firstPart, 10);
      if (!isNaN(parsed) && parsed > 0) {
        lineNum = parsed;
      }
    }

    // Mark as posting
    this.aiItems.update(items =>
      items.map(s => s.id === ri.id ? { ...s, posting: true, error: '' } : s)
    );
    // Suggestions reference added lines; risks/good practices are general context lines
    const lineType = ri.item.type === 'suggestion' ? 'ADDED' : 'CONTEXT';

    this.bitbucket.postPRComment(repoSlug, prId, commentText, projKey, ri.item.filePath, lineNum, lineType).subscribe({
      next: () => {
        this.aiItems.update(items =>
          items.map(s => s.id === ri.id ? { ...s, posting: false, posted: true } : s)
        );
        this.notify.success('Comment posted to Bitbucket!');
      },
      error: err => {
        this.aiItems.update(items =>
          items.map(s => s.id === ri.id ? { ...s, posting: false, error: err.error?.detail || 'Failed to post' } : s)
        );
        this.notify.error('Failed to post comment to Bitbucket.');
      }
    });
  }
  postAllComments(): void {
    this.aiItems()
      .filter(ri => !ri.posted && !ri.posting)
      .forEach(ri => this.postComment(ri));
  }
  // ─── Analyze ─────────────────────────────────────────────────────────────────

  analyze(): void {
    let repoSlug = this.selectedRepo();
    let prId: number | null = null;
    const input = this.prInput().trim();

    if (!input) return;

    let projKey = this.selectedProject() || undefined;

    // Try parsing as URL
    const parsed = this.bitbucket.parsePRUrl(input);
    if (parsed) {
      projKey = parsed.projectKey;
      repoSlug = parsed.repoSlug;
      prId = parsed.prId;
      if (!this.selectedProject() && this.projects().some(p => p.key === projKey)) {
        this.selectedProject.set(projKey);
      }
      if (!this.selectedRepo() && this.repos().some(r => r.slug === repoSlug)) {
        this.selectedRepo.set(repoSlug);
      }
    } else if (/^\d+$/.test(input) && repoSlug) {
      prId = parseInt(input, 10);
    } else {
      this.notify.error('Please select a repository and enter a valid PR ID, or paste a full PR URL.');
      return;
    }

    if (!repoSlug || !prId) return;

    this.analyzing.set(true);
    this.result.set(null);
    this.aiReviewDone.set(false);
    this.aiItems.set([]);
    this.aiError.set('');

    this.bitbucket.analyzePR(repoSlug, prId, projKey).subscribe({
      next: res => {
        this.result.set(res);
        this.analyzing.set(false);
        if (res.gaps.length === 0) this.notify.success('All clear! No gaps found.');
        else this.notify.warn(`Found ${res.gaps.length} potential gaps/issues.`);
      },
      error: err => {
        this.analyzing.set(false);
        this.notify.error('Failed to analyze PR. Check URL/ID or permissions.');
        console.error(err);
      }
    });
  }

  clear(): void {
    this.selectedProject.set(null);
    this.selectedRepo.set(null);
    this.prInput.set('');
    this.result.set(null);
    this.openPRs.set([]);
    this.pageIndex.set(0);
    this.aiReviewDone.set(false);
    this.aiItems.set([]);
    this.aiError.set('');
  }

  onPageChange(e: PageEvent): void {
    this.pageSize.set(e.pageSize);
    this.pageIndex.set(e.pageIndex);
  }

  getTicket(id: string) {
    return this.result()?.tickets.find((t: any) => t.key === id);
  }

  getMissingTicketCommits() {
    return this.result()?.missingTicketCommits || [];
  }

  get postedCount(): number {
    return this.aiItems().filter(s => s.posted).length;
  }

  get totalItems(): number {
    return this.aiItems().length;
  }

  getSeverityIcon(sev: string | undefined): string {
    if (sev === 'error') return 'error';
    if (sev === 'warn') return 'warning';
    return 'info';
  }

  getFileExt(filePath: string | undefined): string {
    if (!filePath) return '';
    const dot = filePath.lastIndexOf('.');
    return dot > -1 ? filePath.substring(dot + 1).toUpperCase() : '';
  }

  getFileName(filePath: string | undefined): string {
    if (!filePath) return '';
    return filePath.split('/').pop() || filePath;
  }

  formatMarkdown(text: string | undefined): string {
    if (!text) return '';
    // Escape HTML first to prevent XSS
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    
    // Replace `code` with <code class="inline-code">code</code>
    escaped = escaped.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    
    // Replace **bold** with <strong>bold</strong>
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    return escaped;
  }
}
