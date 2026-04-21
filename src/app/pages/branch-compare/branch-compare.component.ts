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
import { BitbucketProject, BitbucketRepo, BitbucketBranch, BitbucketTag, BranchComparison } from '../../core/models/bitbucket.models';
import { TicketBadgeComponent } from '../../shared/components/ticket-badge/ticket-badge.component';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

@Component({
  selector: 'app-branch-compare',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatPaginatorModule, MatTooltipModule, MatSlideToggleModule, TicketBadgeComponent,
  ],
  templateUrl: './branch-compare.component.html',
  styleUrls: ['./branch-compare.component.scss'],
})
export class BranchCompareComponent implements OnInit {
  projects = signal<BitbucketProject[]>([]);
  repos = signal<BitbucketRepo[]>([]);
  branches = signal<BitbucketBranch[]>([]);
  tags = signal<BitbucketTag[]>([]);

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

  fromType = signal<'branch'|'tag'>('branch');
  toType = signal<'branch'|'tag'>('branch');

  fromRef = signal<string>('');
  toRef = signal<string>('');
  fromSearch = signal('');
  toSearch = signal('');

  filteredFromOptions = computed(() => {
    const t = this.fromSearch().toLowerCase();
    const opts = this.fromType() === 'branch' ? this.branches() : this.tags();
    return opts.filter(o => o.name.toLowerCase().includes(t));
  });

  filteredToOptions = computed(() => {
    const t = this.toSearch().toLowerCase();
    const opts = this.toType() === 'branch' ? this.branches() : this.tags();
    return opts.filter(o => o.name.toLowerCase().includes(t));
  });

  loadingProjects = signal(false);
  loadingRepos = signal(false);
  loadingRefs = signal(false);
  comparing = signal(false);

  result = signal<BranchComparison | null>(null);

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
  ) {}

  ngOnInit(): void {
    this.loadProjects();

    // Consume pre-fill from ArgoCD dashboard (if any)
    const preFill = this.compareState.consume();
    if (preFill) {
      this._applyPreFill(preFill);
    }
  }

  /**
   * Applies ArgoCD pre-fill state:
   * 1. Sets project + triggers repo load
   * 2. After repos load, sets repo + triggers ref load
   * 3. After refs load, sets fromRef/toRef
   */
  private _applyPreFill(state: import('../../core/services/branch-compare-state.service').BranchComparePreFill) {
    const { project, repository, fromRef, fromType, toRef, toType } = state;

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

        // Load branches + tags, then set refs
        const slug = repo.slug;
        const b$ = this.bitbucket.getBranches(slug, proj.key);
        const t$ = this.bitbucket.getTags(slug, proj.key);

        b$.subscribe(bx => this.branches.set(bx));
        t$.subscribe(tx => {
          this.tags.set(tx);
          this.loadingRefs.set(false);

          // Set the refs after branches/tags are loaded
          this.fromType.set(fromType);
          this.toType.set(toType);
          this.fromRef.set(fromRef);
          this.toRef.set(toRef);

          this.notify.success(`Pre-filled: ${project}/${repository} — ${fromRef} → ${toRef}`);
        });
      });
    });
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
        this.branches.set([]);
        this.tags.set([]);
      },
      error: () => this.notify.error('Failed to load repositories')
    });
  }

  onRepoChange(slug: string): void {
    this.selectedRepo.set(slug);
    this.loadRefs(slug);
  }

  loadRefs(slug: string): void {
    this.loadingRefs.set(true);
    this.fromRef.set('');
    this.toRef.set('');
    
    const proj = this.selectedProject() || undefined;

    const b$ = this.bitbucket.getBranches(slug, proj).pipe(catchError(() => of([])));
    const t$ = this.bitbucket.getTags(slug, proj).pipe(catchError(() => of([])));

    b$.subscribe(bx => {
      this.branches.set(bx);
      // Auto-select main branch as destination usually
      const main = bx.find(b => b.name === 'main' || b.name === 'master');
      if (main) this.toRef.set(main.name);
    });

    t$.subscribe(tx => {
      this.tags.set(tx);
      this.loadingRefs.set(false);
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

  swapRefs(): void {
    const f = this.fromRef();
    const t = this.toRef();
    const ft = this.fromType();
    const tt = this.toType();

    this.fromType.set(tt);
    this.toType.set(ft);
    this.fromRef.set(t);
    this.toRef.set(f);
  }

  clear(): void {
    this.selectedProject.set(null);
    this.selectedRepo.set(null);
    this.fromRef.set('');
    this.toRef.set('');
    this.result.set(null);
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
        'text/html':  new Blob([html],  { type: 'text/html' }),
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
