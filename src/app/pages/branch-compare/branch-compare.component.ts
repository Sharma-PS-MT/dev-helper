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
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchCompareStateService } from '../../core/services/branch-compare-state.service';
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
    MatProgressSpinnerModule, MatPaginatorModule, TicketBadgeComponent,
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
    private compareState: BranchCompareStateService,
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
}
