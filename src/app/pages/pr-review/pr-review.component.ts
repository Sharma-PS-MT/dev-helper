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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { BitbucketProject, BitbucketRepo, PRAnalysis, BitbucketPR, PRCreationResult } from '../../core/models/bitbucket.models';
import { TicketBadgeComponent } from '../../shared/components/ticket-badge/ticket-badge.component';
import { OpenRouterService, AIReviewItem } from '../../core/services/openrouter.service';
import { of, forkJoin } from 'rxjs';
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

/** Represents a single repo row in the bulk PR creation table */
export interface PRCreateRepoRow {
  repo: BitbucketRepo;
  selected: boolean;
  /** idle | validating | ok | source-missing | target-missing | creating | created | exists | error */
  status: string;
  remarks: string;
  prId: number | null;
  prUrl: string | null;
}

@Component({
  selector: 'app-pr-review',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MatCardModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatProgressSpinnerModule, MatPaginatorModule,
    MatTooltipModule, MatDividerModule, MatCheckboxModule, TicketBadgeComponent,
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

  // ─── PR Creation Panel ───────────────────────────────────────────────────────
  createPanelOpen = signal(true);

  // Branch inputs
  createSourceBranch = signal('');
  createTargetBranch = signal('');
  createPRTitle = signal('');
  createPRDescription = signal('');

  // Project selection for PR creation (separate from the review section)
  createSelectedProject = signal<string | null>(null);
  createProjectSearch = signal('');
  createRepos = signal<PRCreateRepoRow[]>([]);
  loadingCreateRepos = signal(false);
  creatingPRs = signal(false);
  validatingBranches = signal(false);

  filteredCreateProjects = computed(() => {
    const t = this.createProjectSearch().toLowerCase();
    return this.projects().filter(p =>
      (p.name || '').toLowerCase().includes(t) || (p.key || '').toLowerCase().includes(t)
    );
  });

  /** True if all validatable rows (ok/source-missing/target-missing) are done */
  validationDone = computed(() =>
    this.createRepos().length > 0 &&
    this.createRepos().every(r => r.status !== 'idle' && r.status !== 'validating')
  );

  /** Count of rows with status 'ok' */
  createValidCount = computed(() => this.createRepos().filter(r => r.status === 'ok').length);

  /** Whether the Make PR button should be enabled */
  canMakePRs = computed(() =>
    !this.creatingPRs() &&
    this.validationDone() &&
    this.createRepos().some(r => r.selected && r.status === 'ok')
  );

  allCreateSelected = computed(() =>
    this.createRepos().length > 0 &&
    this.createRepos().filter(r => r.status === 'ok').every(r => r.selected)
  );

  someCreateSelected = computed(() =>
    this.createRepos().some(r => r.selected) && !this.allCreateSelected()
  );

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

  // ─── PR Creation Handlers ────────────────────────────────────────────────────

  onCreateProjectChange(key: string): void {
    this.createSelectedProject.set(key);
    this.createRepos.set([]);
    this.loadingCreateRepos.set(true);
    this.bitbucket.getRepositories(key).subscribe({
      next: rx => {
        this.createRepos.set(rx.map(repo => ({
          repo,
          selected: true,
          status: 'idle',
          remarks: '',
          prId: null,
          prUrl: null,
        })));
        this.loadingCreateRepos.set(false);
      },
      error: () => {
        this.notify.error('Failed to load repositories');
        this.loadingCreateRepos.set(false);
      }
    });
  }

  toggleSelectAllCreate(checked: boolean): void {
    this.createRepos.update(rows =>
      rows.map(r => ({ ...r, selected: r.status === 'ok' ? checked : r.selected }))
    );
  }

  toggleRowSelect(repo: BitbucketRepo, checked: boolean): void {
    this.createRepos.update(rows =>
      rows.map(r => r.repo.slug === repo.slug ? { ...r, selected: checked } : r)
    );
  }

  /** Validates source+target branch for every repo row */
  validateBranchesForCreate(): void {
    const src = this.createSourceBranch().trim();
    const tgt = this.createTargetBranch().trim();
    const projKey = this.createSelectedProject();

    if (!src || !tgt) {
      this.notify.error('Please enter both source and target branch names.');
      return;
    }
    if (src === tgt) {
      this.notify.error('Source and target branch cannot be the same.');
      return;
    }
    if (!projKey) {
      this.notify.error('Please select a project first.');
      return;
    }
    if (this.createRepos().length === 0) {
      this.notify.error('No repositories loaded. Select a project first.');
      return;
    }

    this.validatingBranches.set(true);

    // Reset all rows to validating
    this.createRepos.update(rows => rows.map(r => ({ ...r, status: 'validating', remarks: '', prId: null, prUrl: null })));

    const repos = this.createRepos();
    let completed = 0;

    repos.forEach(row => {
      // Use the create endpoint for validation — it returns branch status
      this.bitbucket.createPullRequest(
        projKey,
        row.repo.slug,
        src,
        tgt,
        '___validate_only___', // placeholder; skipped since we only care about branch status
        ''
      ).subscribe({
        next: res => {
          // For validation we only use branch-check statuses, NOT actually create
          // But since we send a real title, the endpoint may create if branches exist.
          // We'll call a lightweight branch-check instead.
          // This branch handles the response from the actual create call done for validation.
          this.applyValidationResult(row.repo.slug, res);
          completed++;
          if (completed === repos.length) this.validatingBranches.set(false);
        },
        error: () => {
          this.updateRow(row.repo.slug, { status: 'error', remarks: 'Validation request failed' });
          completed++;
          if (completed === repos.length) this.validatingBranches.set(false);
        }
      });
    });
  }

  /** Validates branches only (uses getBranches with filterText) — lightweight version */
  validateBranchesOnly(): void {
    const src = this.createSourceBranch().trim();
    const tgt = this.createTargetBranch().trim();
    const projKey = this.createSelectedProject();

    if (!src || !tgt) { this.notify.error('Please enter both source and target branch names.'); return; }
    if (src === tgt) { this.notify.error('Source and target branch cannot be the same.'); return; }
    if (!projKey) { this.notify.error('Please select a project first.'); return; }
    if (this.createRepos().length === 0) { this.notify.error('No repositories loaded. Select a project first.'); return; }

    this.validatingBranches.set(true);
    this.createRepos.update(rows => rows.map(r => ({ ...r, status: 'validating', remarks: '', prId: null, prUrl: null })));

    const repos = this.createRepos();
    let completed = 0;

    repos.forEach(row => {
      // Check source and target branches in parallel
      const srcCheck$ = this.bitbucket.getBranches(row.repo.slug, projKey, src, undefined, 5).pipe(
        catchError(() => of({ values: [], limit: 5, isLastPage: true }))
      );
      const tgtCheck$ = this.bitbucket.getBranches(row.repo.slug, projKey, tgt, undefined, 5).pipe(
        catchError(() => of({ values: [], limit: 5, isLastPage: true }))
      );

      forkJoin({ src: srcCheck$, tgt: tgtCheck$ }).subscribe({
        next: ({ src: srcResult, tgt: tgtResult }) => {
          const srcFound = srcResult.values.some((b: any) => b.name === src);
          const tgtFound = tgtResult.values.some((b: any) => b.name === tgt);

          if (!srcFound) {
            this.updateRow(row.repo.slug, { status: 'source-missing', remarks: `Source branch '${src}' not found`, selected: false });
          } else if (!tgtFound) {
            this.updateRow(row.repo.slug, { status: 'target-missing', remarks: `Target branch '${tgt}' not found`, selected: false });
          } else {
            this.updateRow(row.repo.slug, { status: 'ok', remarks: 'Both branches found', selected: true });
          }
          completed++;
          if (completed === repos.length) this.validatingBranches.set(false);
        },
        error: () => {
          this.updateRow(row.repo.slug, { status: 'error', remarks: 'Branch check failed', selected: false });
          completed++;
          if (completed === repos.length) this.validatingBranches.set(false);
        }
      });
    });
  }

  private applyValidationResult(repoSlug: string, res: PRCreationResult): void {
    switch (res.status) {
      case 'source_branch_missing':
        this.updateRow(repoSlug, { status: 'source-missing', remarks: res.message, selected: false });
        break;
      case 'target_branch_missing':
        this.updateRow(repoSlug, { status: 'target-missing', remarks: res.message, selected: false });
        break;
      case 'already_exists':
        this.updateRow(repoSlug, { status: 'exists', remarks: res.message, prId: res.pr_id, prUrl: res.pr_url, selected: false });
        break;
      case 'created':
        this.updateRow(repoSlug, { status: 'created', remarks: res.message, prId: res.pr_id, prUrl: res.pr_url });
        break;
      case 'error':
        this.updateRow(repoSlug, { status: 'error', remarks: res.message, selected: false });
        break;
      default:
        this.updateRow(repoSlug, { status: 'ok', remarks: 'Branches found' });
    }
  }

  /** Executes PR creation for all selected rows with status 'ok' */
  makePRs(): void {
    const src = this.createSourceBranch().trim();
    const tgt = this.createTargetBranch().trim();
    const projKey = this.createSelectedProject();
    const title = this.createPRTitle().trim() || `${src} → ${tgt}`;
    const description = this.createPRDescription().trim();

    if (!projKey) { this.notify.error('No project selected.'); return; }

    const targetRows = this.createRepos().filter(r => r.selected && r.status === 'ok');
    if (targetRows.length === 0) {
      this.notify.error('No valid repositories selected. Run validation first.');
      return;
    }

    this.creatingPRs.set(true);
    let completed = 0;
    let createdCount = 0;
    let skippedCount = 0;

    targetRows.forEach(row => {
      this.updateRow(row.repo.slug, { status: 'creating', remarks: 'Creating PR...' });

      this.bitbucket.createPullRequest(projKey, row.repo.slug, src, tgt, title, description).subscribe({
        next: res => {
          this.applyValidationResult(row.repo.slug, res);
          if (res.status === 'created') createdCount++;
          if (res.status === 'already_exists') skippedCount++;
          completed++;
          if (completed === targetRows.length) {
            this.creatingPRs.set(false);
            this.notify.success(`Done! ${createdCount} PR(s) created, ${skippedCount} skipped (already exist).`);
          }
        },
        error: err => {
          const msg = err?.error?.detail || err?.message || 'Request failed';
          this.updateRow(row.repo.slug, { status: 'error', remarks: msg, selected: false });
          completed++;
          if (completed === targetRows.length) this.creatingPRs.set(false);
        }
      });
    });
  }

  private updateRow(repoSlug: string, patch: Partial<PRCreateRepoRow>): void {
    this.createRepos.update(rows =>
      rows.map(r => r.repo.slug === repoSlug ? { ...r, ...patch } : r)
    );
  }

  getCreateRowStatusIcon(status: string): string {
    switch (status) {
      case 'ok': return 'check_circle';
      case 'created': return 'task_alt';
      case 'exists': return 'info';
      case 'source-missing': return 'cancel';
      case 'target-missing': return 'cancel';
      case 'error': return 'error';
      case 'validating': return 'sync';
      case 'creating': return 'sync';
      default: return 'radio_button_unchecked';
    }
  }

  getCreateRowStatusClass(status: string): string {
    switch (status) {
      case 'ok': return 'status-ok';
      case 'created': return 'status-created';
      case 'exists': return 'status-exists';
      case 'source-missing':
      case 'target-missing': return 'status-missing';
      case 'error': return 'status-error';
      case 'validating':
      case 'creating': return 'status-validating';
      default: return 'status-idle';
    }
  }

  resetCreatePanel(): void {
    this.createRepos.update(rows => rows.map(r => ({
      ...r, status: 'idle', remarks: '', prId: null, prUrl: null, selected: true
    })));
    this.createPRTitle.set('');
    this.createPRDescription.set('');
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
