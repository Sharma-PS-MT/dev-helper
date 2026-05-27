import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchCompareStateService } from '../../core/services/branch-compare-state.service';
import { AuthConfigService } from '../../core/services/auth-config.service';
import { BitbucketProject, BitbucketRepo, BitbucketBranch, BitbucketTag, BranchComparison, BranchGapAnalysis } from '../../core/models/bitbucket.models';
import { TicketBadgeComponent } from '../../shared/components/ticket-badge/ticket-badge.component';
import { RefGroupPipe } from '../../shared/pipes/ref-group.pipe';
import { catchError, finalize } from 'rxjs/operators';
import { of, forkJoin, Observable } from 'rxjs';

@Component({
  selector: 'app-branch-compare',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatPaginatorModule, MatTooltipModule, MatSlideToggleModule,
    TicketBadgeComponent, RefGroupPipe,
  ],
  templateUrl: './branch-compare.component.html',
  styleUrls: ['./branch-compare.component.scss'],
})
export class BranchCompareComponent implements OnInit {
  projects = signal<BitbucketProject[]>([]);
  repos = signal<BitbucketRepo[]>([]);
  
  selectedProject = signal<string | null>(null);
  selectedRepo = signal<string | null>(null);

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

  fromRef = signal<string>('');
  toRef   = signal<string>('');
  fromSearch = signal('');
  toSearch   = signal('');

  // ── Branch side (Destination / Into) ────────────────────────────────────
  branches     = signal<any[]>([]);   // full list from API
  fromOptions  = signal<any[]>([]);   // filtered for display
  fromLoadingOptions = signal(false);

  // ── Tag side (Source / From) ─────────────────────────────────────────────
  allTags      = signal<any[]>([]);   // full list from API
  toOptions    = signal<any[]>([]);   // filtered for display
  toLoadingOptions   = signal(false);

  /** Legacy type stubs so pre-fill/swap code still compiles */
  fromType = signal<'branch' | 'tag'>('branch');
  toType   = signal<'branch' | 'tag'>('tag');


  loadingProjects = signal(false);
  loadingRepos = signal(false);
  loadingRefs = signal(false);
  comparing = signal(false);
  analyzingGap = signal(false);

  gapResult = signal<BranchGapAnalysis | null>(null);

  // ── Critical column filters (independent) ───────────────────────────────
  /** Critical: exclude branch merge commits */
  gapExcludeMergeCommits = signal(true);
  /** Critical: exclude PR merge commits */
  gapExcludePullRequests = signal(true);

  // ── Incoming column filters (independent) ───────────────────────────────
  /** Incoming: exclude branch merge commits */
  gapIncomingExcludeMergeCommits = signal(true);
  /** Incoming: exclude PR merge commits */
  gapIncomingExcludePullRequests = signal(true);

  filteredCriticalCommits = computed(() => {
    const gap = this.gapResult();
    if (!gap) return [];
    const exM = this.gapExcludeMergeCommits();
    const exP = this.gapExcludePullRequests();
    return gap.criticalCommits.filter(cwt => {
      const msg = cwt.commit.message.trim();
      if (exM && BranchCompareComponent.MERGE_PATTERNS.some(p => p.test(msg))) return false;
      if (exP && BranchCompareComponent.PR_PATTERNS.some(p => p.test(msg))) return false;
      return true;
    });
  });

  filteredIncomingCommits = computed(() => {
    const gap = this.gapResult();
    if (!gap) return [];
    const exM = this.gapIncomingExcludeMergeCommits();
    const exP = this.gapIncomingExcludePullRequests();
    return gap.incomingCommits.filter(cwt => {
      const msg = cwt.commit.message.trim();
      if (exM && BranchCompareComponent.MERGE_PATTERNS.some(p => p.test(msg))) return false;
      if (exP && BranchCompareComponent.PR_PATTERNS.some(p => p.test(msg))) return false;
      return true;
    });
  });

  results = signal<(BranchComparison & { repoSlug?: string })[]>([]); 
  result = signal<BranchComparison | null>(null);

  multiQueue = signal<import('../../core/services/branch-compare-state.service').BranchComparePreFill[]>([]);
  multiIndex = signal(0);

  get hasNext() { return this.multiIndex() < this.multiQueue().length - 1; }
  get hasPrev() { return this.multiIndex() > 0; }

  /** When true, commits whose message starts with common branch-merge patterns are hidden */
  excludeMergeCommits = signal(true);

  /** When true, commits whose message is a Pull Request merge are hidden */
  excludePullRequests = signal(true);

  private static readonly MERGE_PATTERNS = [
    // GitHub / Git standard — branch merges (NOT PR merges)
    /^merge branch /i,
    /^merge remote-tracking branch /i,
    /^merge tag /i,
    // Bitbucket Server — "Merged feature/branch into master" (branch merge, not PR)
    /^merged .+ into /i,
    // Revert of a merge
    /^revert "?merge /i,
    // Auto-merge bots
    /^auto-merge /i,
  ];

  private static readonly PR_PATTERNS = [
    // GitHub / Bitbucket Cloud — "Merge pull request #N ..."
    /^merge pull request /i,
    /^merge pull request #/i,
    // Bitbucket Server — "Merged in feature/branch (pull request #N)"
    /^merged in /i,
    // Bitbucket Server — "Pull request #N: ..."  ← this is the actual PR merge commit title
    /^pull request #\d+:/i,
    // Bitbucket old-style — "merged (pull|...) ..."
    /^merged (pull|remote)/i,
  ];

  /** All commits after applying the merge-commit and PR exclusion filters */
  filteredCommits = computed(() => {
    const res = this.result();
    if (!res) return [];

    const excludeMerges = this.excludeMergeCommits();
    const excludePRs = this.excludePullRequests();

    return res.commits.filter(cwt => {
      const msg = cwt.commit.message.trim();
      if (excludeMerges && BranchCompareComponent.MERGE_PATTERNS.some(p => p.test(msg))) return false;
      if (excludePRs && BranchCompareComponent.PR_PATTERNS.some(p => p.test(msg))) return false;
      return true;
    });
  });

  pageSize = signal(50);
  pageIndex = signal(0);

  paginatedCommits = computed(() => {
    const commits = this.filteredCommits();
    const start = this.pageIndex() * this.pageSize();
    return commits.slice(start, start + this.pageSize());
  });

  constructor(
    private bitbucket: BitbucketService,
    private notify: NotificationService,
    private compareState: BranchCompareStateService,
    private authConfig: AuthConfigService,
  ) { }

  ngOnInit(): void {
    this.loadProjects();

    // Consume pre-fill from ArgoCD dashboard (if any)
    const preFill = this.compareState.consume();
    if (preFill) {
      this._applyPreFill(preFill);
    }
  }

  /** Filter branches list as user types */
  onFromSearch(text: string) {
    this.fromSearch.set(text);
    const lower = text.toLowerCase().trim();
    const filtered = lower
      ? this.branches().filter(o => o.name.toLowerCase().includes(lower))
      : this.branches();
    this.fromOptions.set(filtered);
  }

  /** Filter tags list as user types */
  onToSearch(text: string) {
    this.toSearch.set(text);
    const lower = text.toLowerCase().trim();
    const filtered = lower
      ? this.allTags().filter(o => o.name.toLowerCase().includes(lower))
      : this.allTags();
    this.toOptions.set(filtered);
  }

  /** When a branch is selected, auto-select the latest (first) tag */
  onBranchSelected(branchName: string) {
    this.fromRef.set(branchName);
    const latestTag = this.allTags()[0];
    if (latestTag && !this.toRef()) {
      this.toRef.set(latestTag.name);
    }
  }

  /**
   * Loads branches (for left/from side) OR tags (for right/to side) separately.
   * Called by loadRefs() and by pre-fill logic.
   */
  loadRefsForSide(side: 'from' | 'to', _append = false, _filterText?: string): Observable<any> {
    const repo = this.selectedRepo();
    if (!repo) return of(null);
    const proj = this.selectedProject() || undefined;

    if (side === 'from') {
      // Load branches
      this.fromLoadingOptions.set(true);
      return this.bitbucket.getBranches(repo, proj, '', 0).pipe(
        tap((res: any) => {
          const items = (res.values || []);
          this.branches.set(items);
          this.fromOptions.set(items);
          this.fromLoadingOptions.set(false);
        }),
        catchError(() => { this.fromLoadingOptions.set(false); return of(null); })
      );
    } else {
      // Load tags
      this.toLoadingOptions.set(true);
      return this.bitbucket.getTags(repo, proj, '', 0).pipe(
        tap((res: any) => {
          const items = (res.values || []);
          this.allTags.set(items);
          this.toOptions.set(items);
          this.toLoadingOptions.set(false);
          // Auto-select latest tag if none chosen yet
          if (items.length > 0 && !this.toRef()) {
            this.toRef.set(items[0].name);
          }
        }),
        catchError(() => { this.toLoadingOptions.set(false); return of(null); })
      );
    }
  }

  registerScrollListener(_opened: boolean, _side: 'from' | 'to') {
    // Not needed — full list loaded upfront
  }

  /**
   * Applies ArgoCD pre-fill state:
   * 1. Sets multiQueue and multiIndex
   * 2. Loads the first queue item
   */
  private _applyPreFill(queue: import('../../core/services/branch-compare-state.service').BranchComparePreFill[]) {
    if (queue.length === 0) return;
    
    this.multiQueue.set(queue);
    this.multiIndex.set(0);
    this._loadQueueItem(0);
  }

  private _loadQueueItem(index: number) {
    const queue = this.multiQueue();
    if (index < 0 || index >= queue.length) return;
    
    const state = queue[index];
    const { project, repository, fromRef, fromType, toRef, toType } = state;

    this.result.set(null);

    // Wait for projects to load, then auto-select
    this.bitbucket.getProjects().subscribe(projects => {
      this.projects.set(projects);
      this.loadingProjects.set(false);

      const proj = projects.find(p => p.key?.toLowerCase() === project.toLowerCase());
      if (!proj) {
        this.notify.error(`Project "${project}" not found in Bitbucket.`);
        return;
      }

      this.selectedProject.set(proj.key);

      // Load repos for the project
      this.bitbucket.getRepositories(proj.key).subscribe(repos => {
        this.repos.set(repos);
        this.loadingRepos.set(false);

        const repo = repos.find(r =>
          r.slug?.toLowerCase() === repository.toLowerCase() ||
          r.name?.toLowerCase() === repository.toLowerCase()
        );

        if (!repo) {
          this.notify.error(`Repository "${repository}" not found in project "${project}".`);
          return;
        }

        this.selectedRepo.set(repo.slug);

        // Set the types and refs first
        this.fromType.set(fromType);
        this.toType.set(toType);
        this.fromRef.set(fromRef);
        this.toRef.set(toRef);
        
        this.fromStart.set(0);
        this.toStart.set(0);

        // Load the options for the specific types
        forkJoin({
          from: this.loadRefsForSide('from', false),
          to: this.loadRefsForSide('to', false)
        }).subscribe(() => {
          // Ensure the selected refs are in the options list so mat-select displays them properly
          const fOpts = this.fromOptions();
          if (fromRef && !fOpts.some(o => o.name === fromRef)) {
            this.fromOptions.set([{ name: fromRef, target: { hash: '' } }, ...fOpts]);
          }

          const tOpts = this.toOptions();
          if (toRef && !tOpts.some(o => o.name === toRef)) {
            this.toOptions.set([{ name: toRef, target: { hash: '' } }, ...tOpts]);
          }

          this.loadingRefs.set(false);

          if (queue.length > 1) {
            this.notify.success(`Loaded ${index + 1} of ${queue.length}: ${project}/${repository}`);
          }
          
          this.compare();
        });
      });
    });
  }

  nextCompare() {
    if (this.hasNext) {
      this.multiIndex.update(i => i + 1);
      this._loadQueueItem(this.multiIndex());
    }
  }

  prevCompare() {
    if (this.hasPrev) {
      this.multiIndex.update(i => i - 1);
      this._loadQueueItem(this.multiIndex());
    }
  }

  loadProjects(): void {
    this.loadingProjects.set(true);
    this.bitbucket.getProjects().pipe(
      finalize(() => this.loadingProjects.set(false))
    ).subscribe({
      next: px => this.projects.set(px),
      error: () => this.notify.error('Failed to load projects')
    });
  }

  onProjectChange(key: string): void {
    this.selectedProject.set(key);
    this.selectedRepo.set(null);
    this.loadingRepos.set(true);
    this.bitbucket.getRepositories(key).pipe(
      finalize(() => this.loadingRepos.set(false))
    ).subscribe({
      next: rx => {
        this.repos.set(rx);
        this.fromOptions.set([]);
        this.toOptions.set([]);
      },
      error: () => this.notify.error('Failed to load repositories')
    });
  }

  onRepoChange(slug: string): void {
    this.selectedRepo.set(slug);
    this.loadRefs();
  }

  loadRefs(): void {
    this.loadingRefs.set(true);
    this.fromRef.set('');
    this.toRef.set('');
    this.fromStart.set(0);
    this.toStart.set(0);

    forkJoin({
      from: this.loadRefsForSide('from'),
      to: this.loadRefsForSide('to')
    }).pipe(
      finalize(() => this.loadingRefs.set(false))
    ).subscribe(() => {
      // Auto-select the configured default branch (or fall back to main/master)
      const defaultBranch = this.authConfig.config().bitbucketDefaultBranch || 'main';
      const preferred = this.toOptions().find(o => o.name === defaultBranch)
        ?? this.toOptions().find(o => o.name === 'main' || o.name === 'master');
      if (preferred) this.toRef.set(preferred.name);
    });
  }

  compare(): void {
    const p = this.selectedProject() || undefined;
    const r = this.selectedRepo();
    const f = this.fromRef();
    const t = this.toRef();
    if (!r || !f || !t) return;

    this.comparing.set(true);
    this.result.set(null);

    this.bitbucket.compareBranchesOrTags(r, f, t, p).pipe(
      finalize(() => this.comparing.set(false))
    ).subscribe({
      next: res => this.result.set(res),
      error: err => {
        this.notify.error('Comparison failed. Check ref names or API limits.');
        console.error(err);
      }
    });
  }

  analyzeGap(): void {
    const p = this.selectedProject() || undefined;
    const r = this.selectedRepo();
    const f = this.fromRef();
    const t = this.toRef();
    if (!r || !f || !t) return;

    this.analyzingGap.set(true);
    this.gapResult.set(null);

    this.bitbucket.analyzeGap(r, f, t, p).pipe(
      finalize(() => this.analyzingGap.set(false))
    ).subscribe({
      next: res => this.gapResult.set(res),
      error: err => {
        this.notify.error('Gap analysis failed. Check ref names or API limits.');
        console.error(err);
      }
    });
  }

  swapRefs(): void {
    const fRef = this.fromRef();
    const tRef = this.toRef();
    const fType = this.fromType();
    const tType = this.toType();
    
    const fOpts = this.fromOptions();
    const tOpts = this.toOptions();
    
    const fSearch = this.fromSearch();
    const tSearch = this.toSearch();
    
    const fStart = this.fromStart();
    const tStart = this.toStart();
    
    const fHasMore = this.fromHasMore();
    const tHasMore = this.toHasMore();

    this.fromType.set(tType);
    this.toType.set(fType);
    
    this.fromRef.set(tRef);
    this.toRef.set(fRef);
    
    this.fromOptions.set(tOpts);
    this.toOptions.set(fOpts);
    
    this.fromSearch.set(tSearch);
    this.toSearch.set(fSearch);
    
    this.fromStart.set(tStart);
    this.toStart.set(fStart);
    
    this.fromHasMore.set(tHasMore);
    this.toHasMore.set(fHasMore);
  }

  clear(): void {
    this.selectedProject.set(null);
    this.selectedRepo.set(null);
    this.fromRef.set('');
    this.toRef.set('');
    this.result.set(null);
    this.multiQueue.set([]);
    this.multiIndex.set(0);
    this.pageIndex.set(0);
  }

  onPageChange(e: PageEvent): void {
    this.pageSize.set(e.pageSize);
    this.pageIndex.set(e.pageIndex);
  }

  get totalTickets() { return this.result()?.ticketSummary.total || 0; }
  get donePct() {
    const tot = this.totalTickets;
    if (tot === 0) return 0;
    return Math.round(((this.result()?.ticketSummary.done || 0) / tot) * 100);
  }

  copySuccess = signal(false);

  copyAsTable(): void {
    const commits = this.filteredCommits();
    if (commits.length === 0) return;

    const res      = this.result();
    const repoName = this.selectedRepo() || 'Unknown Repository';
    const fromRef  = res?.fromRef || this.fromRef();
    const toRef    = res?.toRef   || this.toRef();

    // ── Group by unique ticket key — one row per ticket ────────────────────
    type TicketRow = {
      key: string;
      url: string;
      status: string;
      author: string;
      hashes: string[];   // short commit hashes that reference this ticket
    };

    const ticketMap = new Map<string, TicketRow>();

    for (const cwt of commits) {
      const author = (cwt.commit.author.user?.display_name || cwt.commit.author.raw.split('<')[0]).trim();
      const hash = cwt.commit.hash.slice(0, 7);

      // Tickets resolved via JIRA API
      for (const t of cwt.tickets) {
        if (ticketMap.has(t.key)) {
          ticketMap.get(t.key)!.hashes.push(hash);
        } else {
          ticketMap.set(t.key, {
            key: t.key,
            url: t.url || '',
            status: t.status?.name || 'Unknown',
            author,
            hashes: [hash],
          });
        }
      }

      // Ticket IDs mentioned in commit message but not resolved via JIRA
      for (const id of cwt.ticketIds) {
        if (cwt.tickets.some(t => t.key === id)) continue; // already handled above
        if (ticketMap.has(id)) {
          ticketMap.get(id)!.hashes.push(hash);
        } else {
          ticketMap.set(id, { key: id, url: '', status: 'Not Found', author, hashes: [hash] });
        }
      }
    }

    if (ticketMap.size === 0) {
      this.notify.error('No tickets found in the filtered commits.');
      return;
    }

    const rows = Array.from(ticketMap.values());
    const jiraBase = (this.authConfig.config().jiraBaseUrl || '').replace(/\/$/, '');

    // ── Build HTML table ───────────────────────────────────────────────────
    const thStyle = 'border:1px solid #ccc;padding:6px 10px;background:#f4f5f7;font-weight:600;text-align:left;';
    const tdStyle = 'border:1px solid #ccc;padding:6px 10px;vertical-align:top;';

    const headerCells = ['#', 'Ticket', 'Status', 'Author', 'Commits']
      .map(h => `<th style="${thStyle}">${h}</th>`).join('');

    const rowsHtml = rows.map((r, i) => {
      const resolvedUrl = r.url || (jiraBase ? `${jiraBase}/browse/${r.key}` : '');
      // Use URL as BOTH href AND visible text → Confluence Smart Link renders ticket status inline
      const ticketCell = resolvedUrl
        ? `<a href="${resolvedUrl}" target="_blank" rel="noopener">${resolvedUrl}</a>`
        : r.key;
      const hashesCell = r.hashes.map(h => `<code>${h}</code>`).join(', ');

      return `<tr>
        <td style="${tdStyle}">${i + 1}</td>
        <td style="${tdStyle}">${ticketCell}</td>
        <td style="${tdStyle}">${r.status}</td>
        <td style="${tdStyle}">${r.author}</td>
        <td style="${tdStyle}">${hashesCell}</td>
      </tr>`;
    }).join('');

    // ── Title block + table ────────────────────────────────────────────────
    const titleHtml = `
      <h3 style="font-family:sans-serif;margin:0 0 4px 0;font-size:16px;">${repoName}</h3>
      <p style="font-family:sans-serif;margin:0 0 12px 0;font-size:13px;color:#555;">
        Version Diff: <strong>${fromRef}</strong> &rarr; <strong>${toRef}</strong>
      </p>`;

    const html = `${titleHtml}
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

    // ── Plain-text fallback (tab-separated) ────────────────────────────────
    // Use full URL as ticket cell so pasting plain text also triggers Confluence Smart Links
    const plain = [
      `Repository: ${repoName}`,
      `Version Diff: ${fromRef} → ${toRef}`,
      '',
      '#\tTicket\tStatus\tAuthor\tCommits',
      ...rows.map((r, i) => {
        const resolvedUrl = r.url || (jiraBase ? `${jiraBase}/browse/${r.key}` : r.key);
        return `${i + 1}\t${resolvedUrl}\t${r.status}\t${r.author}\t${r.hashes.join(', ')}`;
      })
    ].join('\n');

    // ── Write to clipboard ─────────────────────────────────────────────────
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      navigator.clipboard.write([item]).then(() => {
        this.copySuccess.set(true);
        this.notify.success(`Copied ${rows.length} tickets — paste into Confluence as a rich table!`);
        setTimeout(() => this.copySuccess.set(false), 2500);
      }).catch(() => this.notify.error('Failed to copy to clipboard.'));
    } catch {
      navigator.clipboard.writeText(plain).then(() => {
        this.copySuccess.set(true);
        this.notify.success(`Copied ${rows.length} tickets (plain text fallback).`);
        setTimeout(() => this.copySuccess.set(false), 2500);
      }).catch(() => this.notify.error('Failed to copy to clipboard.'));
    }
  }

}
