import {
  Component,
  OnInit,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthConfigService } from '../../core/services/auth-config.service';
import {
  BitbucketProject,
  BitbucketRepo,
  PRCreationResult,
  BranchCreationResult,
} from '../../core/models/bitbucket.models';
import { of, forkJoin } from 'rxjs';
import { catchError } from 'rxjs/operators';

/** Represents a single repo row in the bulk PR creation table */
export interface PRCreateRepoRow {
  repo: BitbucketRepo;
  projectKey: string;
  selected: boolean;
  /** idle | validating | ok | source-missing | target-missing | creating | created | exists | error */
  status: string;
  remarks: string;
  prId: number | null;
  prUrl: string | null;
}

/** Represents a single repo row in the bulk Branch creation table */
export interface BranchCreateRepoRow {
  repo: BitbucketRepo;
  projectKey: string;
  selected: boolean;
  /** idle | validating | source-ok | source-missing | creating | created | already-exists | error */
  status: string;
  remarks: string;
  branchUrl: string | null;
}

@Component({
  selector: 'app-pr-creation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatTabsModule,
    MatChipsModule,
  ],
  templateUrl: './pr-creation.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./pr-creation.component.scss'],
})
export class PrCreationComponent implements OnInit {
  private authConfig = inject(AuthConfigService);

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── PR CREATION TAB ──────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Projects ─────────────────────────────────────────────────────────────
  projects = signal<BitbucketProject[]>([]);
  loadingProjects = signal(false);
  projectSearch = signal('');

  filteredProjects = computed(() => {
    const t = this.projectSearch().toLowerCase();
    return this.projects().filter(
      (p) => (p.name || '').toLowerCase().includes(t) || (p.key || '').toLowerCase().includes(t),
    );
  });

  // ─── PR Creation Panel ────────────────────────────────────────────────────
  createSourceBranch = signal('');
  createTargetBranch = signal('');
  createPRTitle = signal('');
  createPRDescription = signal('');

  selectedProject = signal<string | null>(null);
  repos = signal<PRCreateRepoRow[]>([]);
  loadingRepos = signal(false);
  creatingPRs = signal(false);
  validatingBranches = signal(false);

  validationDone = computed(
    () =>
      this.repos().length > 0 &&
      this.repos().every((r) => r.status !== 'idle' && r.status !== 'validating'),
  );

  validCount = computed(() => this.repos().filter((r) => r.status === 'ok').length);

  canMakePRs = computed(
    () =>
      !this.creatingPRs() &&
      this.validationDone() &&
      this.repos().some((r) => r.selected && r.status === 'ok'),
  );

  allSelected = computed(
    () =>
      this.repos().length > 0 &&
      this.repos()
        .filter((r) => r.status === 'ok')
        .every((r) => r.selected),
  );

  someSelected = computed(() => this.repos().some((r) => r.selected) && !this.allSelected());

  // ─── Summary counts ────────────────────────────────────────────────────────
  countOk = computed(() => this.repos().filter((r) => r.status === 'ok').length);
  countMissing = computed(
    () =>
      this.repos().filter((r) => r.status === 'source-missing' || r.status === 'target-missing')
        .length,
  );
  countExists = computed(() => this.repos().filter((r) => r.status === 'exists').length);
  countCreated = computed(() => this.repos().filter((r) => r.status === 'created').length);
  countError = computed(() => this.repos().filter((r) => r.status === 'error').length);

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── CREATE BRANCH TAB ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Inputs ───────────────────────────────────────────────────────────────
  cbNewBranch = signal('');
  cbSourceBranch = signal('');

  // ─── Scope: 'project' | 'stream' ─────────────────────────────────────────
  cbScopeType = signal<'project' | 'stream'>('project');
  cbSelectedStream = signal<string | null>(null);
  cbSelectedProject = signal<string | null>(null);
  cbProjectSearch = signal('');
  cbFilteredProjects = computed(() => {
    const t = this.cbProjectSearch().toLowerCase();
    return this.projects().filter(
      (p) => (p.name || '').toLowerCase().includes(t) || (p.key || '').toLowerCase().includes(t),
    );
  });

  // ─── Available streams from service registry ──────────────────────────────
  availableStreams = computed(() => {
    const registry = this.authConfig.serviceRegistry();
    const streams = registry
      .map((e) => e.stream)
      .filter((s): s is string => !!s && s.trim() !== '');
    return [...new Set(streams)].sort();
  });

  // ─── Branch repo table ────────────────────────────────────────────────────
  cbRepos = signal<BranchCreateRepoRow[]>([]);
  cbLoadingRepos = signal(false);
  cbValidating = signal(false);
  cbCreating = signal(false);

  cbValidationDone = computed(
    () =>
      this.cbRepos().length > 0 &&
      this.cbRepos().every((r) => r.status !== 'idle' && r.status !== 'validating'),
  );

  cbCanCreate = computed(
    () =>
      !this.cbCreating() &&
      this.cbValidationDone() &&
      this.cbRepos().some((r) => r.selected && r.status === 'source-ok'),
  );

  cbAllSelected = computed(
    () =>
      this.cbRepos().length > 0 &&
      this.cbRepos()
        .filter((r) => r.status === 'source-ok')
        .every((r) => r.selected),
  );

  cbSomeSelected = computed(() => this.cbRepos().some((r) => r.selected) && !this.cbAllSelected());

  // ─── CB summary counts ────────────────────────────────────────────────────
  cbCountOk = computed(() => this.cbRepos().filter((r) => r.status === 'source-ok').length);
  cbCountMissing = computed(
    () => this.cbRepos().filter((r) => r.status === 'source-missing').length,
  );
  cbCountCreated = computed(() => this.cbRepos().filter((r) => r.status === 'created').length);
  cbCountExists = computed(
    () => this.cbRepos().filter((r) => r.status === 'already-exists').length,
  );
  cbCountError = computed(() => this.cbRepos().filter((r) => r.status === 'error').length);

  constructor(
    private bitbucket: BitbucketService,
    private notify: NotificationService,
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── PR CREATION METHODS ──────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  loadProjects(): void {
    this.loadingProjects.set(true);
    this.bitbucket.getProjects().subscribe({
      next: (px) => {
        this.projects.set(px);
        this.loadingProjects.set(false);
      },
      error: () => {
        this.notify.error('Failed to load projects');
        this.loadingProjects.set(false);
      },
    });
  }

  onProjectChange(key: string): void {
    this.selectedProject.set(key);
    this.repos.set([]);
    this.loadingRepos.set(true);
    this.bitbucket.getRepositories(key).subscribe({
      next: (rx) => {
        this.repos.set(
          rx.map((repo) => ({
            repo,
            projectKey: key,
            selected: true,
            status: 'idle',
            remarks: '',
            prId: null,
            prUrl: null,
          })),
        );
        this.loadingRepos.set(false);
      },
      error: () => {
        this.notify.error('Failed to load repositories');
        this.loadingRepos.set(false);
      },
    });
  }

  toggleSelectAll(checked: boolean): void {
    this.repos.update((rows) =>
      rows.map((r) => ({ ...r, selected: r.status === 'ok' ? checked : r.selected })),
    );
  }

  toggleRowSelect(repo: BitbucketRepo, checked: boolean): void {
    this.repos.update((rows) =>
      rows.map((r) => (r.repo.slug === repo.slug ? { ...r, selected: checked } : r)),
    );
  }

  validateBranchesOnly(): void {
    const src = this.createSourceBranch().trim();
    const tgt = this.createTargetBranch().trim();
    const projKey = this.selectedProject();

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
    if (this.repos().length === 0) {
      this.notify.error('No repositories loaded. Select a project first.');
      return;
    }

    this.validatingBranches.set(true);
    this.repos.update((rows) =>
      rows.map((r) => ({
        ...r,
        status: 'validating',
        remarks: '',
        prId: null,
        prUrl: null,
      })),
    );

    const repoList = this.repos();
    let completed = 0;

    repoList.forEach((row) => {
      const srcCheck$ = this.bitbucket
        .getBranches(row.repo.slug, projKey, src, undefined, 5)
        .pipe(catchError(() => of({ values: [], limit: 5, isLastPage: true })));

      const tgtCheck$ = this.bitbucket
        .getBranches(row.repo.slug, projKey, tgt, undefined, 5)
        .pipe(catchError(() => of({ values: [], limit: 5, isLastPage: true })));

      forkJoin({ src: srcCheck$, tgt: tgtCheck$ }).subscribe({
        next: ({ src: srcResult, tgt: tgtResult }) => {
          const srcFound = srcResult.values.some((b: any) => b.name === src);
          const tgtFound = tgtResult.values.some((b: any) => b.name === tgt);

          if (!srcFound) {
            this.updateRow(row.repo.slug, {
              status: 'source-missing',
              remarks: `Source branch '${src}' not found`,
              selected: false,
            });
          } else if (!tgtFound) {
            this.updateRow(row.repo.slug, {
              status: 'target-missing',
              remarks: `Target branch '${tgt}' not found`,
              selected: false,
            });
          } else {
            this.updateRow(row.repo.slug, {
              status: 'ok',
              remarks: 'Both branches found',
              selected: true,
            });
          }
          completed++;
          if (completed === repoList.length) this.validatingBranches.set(false);
        },
        error: () => {
          this.updateRow(row.repo.slug, {
            status: 'error',
            remarks: 'Branch check failed',
            selected: false,
          });
          completed++;
          if (completed === repoList.length) this.validatingBranches.set(false);
        },
      });
    });
  }

  makePRs(): void {
    const src = this.createSourceBranch().trim();
    const tgt = this.createTargetBranch().trim();
    const projKey = this.selectedProject();
    const title = this.createPRTitle().trim() || `${src} → ${tgt}`;
    const description = this.createPRDescription().trim();

    if (!projKey) {
      this.notify.error('No project selected.');
      return;
    }

    const targetRows = this.repos().filter((r) => r.selected && r.status === 'ok');
    if (targetRows.length === 0) {
      this.notify.error('No valid repositories selected. Run validation first.');
      return;
    }

    this.creatingPRs.set(true);
    let completed = 0;
    let createdCount = 0;
    let skippedCount = 0;

    targetRows.forEach((row) => {
      this.updateRow(row.repo.slug, { status: 'creating', remarks: 'Creating PR...' });

      this.bitbucket
        .createPullRequest(projKey, row.repo.slug, src, tgt, title, description)
        .subscribe({
          next: (res) => {
            this.applyResult(row.repo.slug, res);
            if (res.status === 'created') createdCount++;
            if (res.status === 'already_exists') skippedCount++;
            completed++;
            if (completed === targetRows.length) {
              this.creatingPRs.set(false);
              this.notify.success(
                `Done! ${createdCount} PR(s) created, ${skippedCount} skipped (already exist).`,
              );
            }
          },
          error: (err) => {
            const msg = err?.error?.detail || err?.message || 'Request failed';
            this.updateRow(row.repo.slug, {
              status: 'error',
              remarks: msg,
              selected: false,
            });
            completed++;
            if (completed === targetRows.length) this.creatingPRs.set(false);
          },
        });
    });
  }

  resetResults(): void {
    this.repos.update((rows) =>
      rows.map((r) => ({
        ...r,
        status: 'idle',
        remarks: '',
        prId: null,
        prUrl: null,
        selected: true,
      })),
    );
  }

  clearAll(): void {
    this.selectedProject.set(null);
    this.repos.set([]);
    this.createSourceBranch.set('');
    this.createTargetBranch.set('');
    this.createPRTitle.set('');
    this.createPRDescription.set('');
    this.projectSearch.set('');
  }

  private applyResult(repoSlug: string, res: PRCreationResult): void {
    switch (res.status) {
      case 'source_branch_missing':
        this.updateRow(repoSlug, {
          status: 'source-missing',
          remarks: res.message,
          selected: false,
        });
        break;
      case 'target_branch_missing':
        this.updateRow(repoSlug, {
          status: 'target-missing',
          remarks: res.message,
          selected: false,
        });
        break;
      case 'already_exists':
        this.updateRow(repoSlug, {
          status: 'exists',
          remarks: res.message,
          prId: res.pr_id,
          prUrl: res.pr_url,
          selected: false,
        });
        break;
      case 'created':
        this.updateRow(repoSlug, {
          status: 'created',
          remarks: res.message,
          prId: res.pr_id,
          prUrl: res.pr_url,
        });
        break;
      case 'error':
        this.updateRow(repoSlug, { status: 'error', remarks: res.message, selected: false });
        break;
      default:
        this.updateRow(repoSlug, { status: 'ok', remarks: 'Branches found' });
    }
  }

  private updateRow(repoSlug: string, patch: Partial<PRCreateRepoRow>): void {
    this.repos.update((rows) =>
      rows.map((r) => (r.repo.slug === repoSlug ? { ...r, ...patch } : r)),
    );
  }

  getStatusIcon(status: string): string {
    const map: Record<string, string> = {
      ok: 'check_circle',
      created: 'task_alt',
      exists: 'info',
      'source-missing': 'cancel',
      'target-missing': 'cancel',
      error: 'error',
      validating: 'sync',
      creating: 'sync',
    };
    return map[status] ?? 'radio_button_unchecked';
  }

  getStatusClass(status: string): string {
    const map: Record<string, string> = {
      ok: 'status-ok',
      created: 'status-created',
      exists: 'status-exists',
      'source-missing': 'status-missing',
      'target-missing': 'status-missing',
      error: 'status-error',
      validating: 'status-validating',
      creating: 'status-validating',
    };
    return map[status] ?? 'status-idle';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── CREATE BRANCH METHODS ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  onCbScopeChange(scope: 'project' | 'stream'): void {
    this.cbScopeType.set(scope);
    this.cbSelectedStream.set(null);
    this.cbSelectedProject.set(null);
    this.cbRepos.set([]);
  }

  onCbStreamChange(streamName: string): void {
    this.cbSelectedStream.set(streamName);
    this.cbRepos.set([]);

    // Gather all project+repo entries that belong to this stream from service registry
    const registry = this.authConfig.serviceRegistry();
    const entries = registry.filter((e) => e.stream === streamName);

    if (entries.length === 0) {
      this.notify.error(`No repositories found for stream "${streamName}".`);
      return;
    }

    this.cbLoadingRepos.set(true);
    let loaded = 0;
    const rows: BranchCreateRepoRow[] = [];

    entries.forEach((entry) => {
      this.bitbucket.getRepositories(entry.project).subscribe({
        next: (allRepos) => {
          // Find the specific repo from registry
          const match = allRepos.find((r) => r.slug === entry.repository);
          if (match) {
            rows.push({
              repo: match,
              projectKey: entry.project,
              selected: true,
              status: 'idle',
              remarks: '',
              branchUrl: null,
            });
          }
          loaded++;
          if (loaded === entries.length) {
            this.cbRepos.set(rows);
            this.cbLoadingRepos.set(false);
          }
        },
        error: () => {
          loaded++;
          if (loaded === entries.length) {
            this.cbRepos.set(rows);
            this.cbLoadingRepos.set(false);
          }
        },
      });
    });
  }

  onCbProjectChange(key: string): void {
    this.cbSelectedProject.set(key);
    this.cbRepos.set([]);
    this.cbLoadingRepos.set(true);
    this.bitbucket.getRepositories(key).subscribe({
      next: (rx) => {
        this.cbRepos.set(
          rx.map((repo) => ({
            repo,
            projectKey: key,
            selected: true,
            status: 'idle',
            remarks: '',
            branchUrl: null,
          })),
        );
        this.cbLoadingRepos.set(false);
      },
      error: () => {
        this.notify.error('Failed to load repositories');
        this.cbLoadingRepos.set(false);
      },
    });
  }

  cbToggleSelectAll(checked: boolean): void {
    this.cbRepos.update((rows) =>
      rows.map((r) => ({ ...r, selected: r.status === 'source-ok' ? checked : r.selected })),
    );
  }

  cbToggleRowSelect(repoSlug: string, checked: boolean): void {
    this.cbRepos.update((rows) =>
      rows.map((r) => (r.repo.slug === repoSlug ? { ...r, selected: checked } : r)),
    );
  }

  /** Validate: does the source branch exist in every repo? */
  validateSourceBranches(): void {
    const src = this.cbSourceBranch().trim();
    const newBranch = this.cbNewBranch().trim();

    if (!newBranch) {
      this.notify.error('Please enter the new branch name to create.');
      return;
    }
    if (!src) {
      this.notify.error('Please enter the source branch (branch to branch FROM).');
      return;
    }
    if (newBranch === src) {
      this.notify.error('New branch name and source branch cannot be the same.');
      return;
    }
    if (this.cbRepos().length === 0) {
      this.notify.error('No repositories loaded. Select a project or stream first.');
      return;
    }

    this.cbValidating.set(true);
    this.cbRepos.update((rows) =>
      rows.map((r) => ({
        ...r,
        status: 'validating',
        remarks: '',
        branchUrl: null,
      })),
    );

    const repoList = this.cbRepos();
    let completed = 0;

    repoList.forEach((row) => {
      this.bitbucket
        .getBranches(row.repo.slug, row.projectKey, src, undefined, 20)
        .pipe(catchError(() => of({ values: [], limit: 20, isLastPage: true })))
        .subscribe({
          next: (result) => {
            const found = result.values.some((b: any) => b.name === src);
            this.updateCbRow(row.repo.slug, {
              status: found ? 'source-ok' : 'source-missing',
              remarks: found
                ? `Source branch '${src}' found — ready to create '${newBranch}'`
                : `Source branch '${src}' not found in this repository`,
              selected: found,
            });
            completed++;
            if (completed === repoList.length) this.cbValidating.set(false);
          },
          error: () => {
            this.updateCbRow(row.repo.slug, {
              status: 'error',
              remarks: 'Branch check failed',
              selected: false,
            });
            completed++;
            if (completed === repoList.length) this.cbValidating.set(false);
          },
        });
    });
  }

  /** Create the branch in all selected + validated repos */
  createBranches(): void {
    const src = this.cbSourceBranch().trim();
    const newBranch = this.cbNewBranch().trim();

    if (!newBranch || !src) {
      this.notify.error('Branch names are required.');
      return;
    }

    const targetRows = this.cbRepos().filter((r) => r.selected && r.status === 'source-ok');
    if (targetRows.length === 0) {
      this.notify.error('No valid repositories selected. Run validation first.');
      return;
    }

    this.cbCreating.set(true);
    let completed = 0;
    let createdCount = 0;
    let skippedCount = 0;

    targetRows.forEach((row) => {
      this.updateCbRow(row.repo.slug, {
        status: 'creating',
        remarks: `Creating '${newBranch}'...`,
      });

      this.bitbucket.createBranch(row.projectKey, row.repo.slug, newBranch, src).subscribe({
        next: (res) => {
          this.applyCbResult(row.repo.slug, res);
          if (res.status === 'created') createdCount++;
          if (res.status === 'already_exists') skippedCount++;
          completed++;
          if (completed === targetRows.length) {
            this.cbCreating.set(false);
            this.notify.success(
              `Done! ${createdCount} branch(es) created, ${skippedCount} already existed.`,
            );
          }
        },
        error: (err) => {
          const msg = err?.error?.detail || err?.message || 'Request failed';
          this.updateCbRow(row.repo.slug, {
            status: 'error',
            remarks: msg,
            selected: false,
          });
          completed++;
          if (completed === targetRows.length) this.cbCreating.set(false);
        },
      });
    });
  }

  cbResetResults(): void {
    this.cbRepos.update((rows) =>
      rows.map((r) => ({
        ...r,
        status: 'idle',
        remarks: '',
        branchUrl: null,
        selected: true,
      })),
    );
  }

  cbClearAll(): void {
    this.cbSelectedProject.set(null);
    this.cbSelectedStream.set(null);
    this.cbRepos.set([]);
    this.cbNewBranch.set('');
    this.cbSourceBranch.set('');
    this.cbProjectSearch.set('');
  }

  private applyCbResult(repoSlug: string, res: BranchCreationResult): void {
    switch (res.status) {
      case 'source_missing':
        this.updateCbRow(repoSlug, {
          status: 'source-missing',
          remarks: res.message,
          selected: false,
        });
        break;
      case 'already_exists':
        this.updateCbRow(repoSlug, {
          status: 'already-exists',
          remarks: res.message,
          branchUrl: res.branch_url,
          selected: false,
        });
        break;
      case 'created':
        this.updateCbRow(repoSlug, {
          status: 'created',
          remarks: res.message,
          branchUrl: res.branch_url,
        });
        break;
      case 'error':
        this.updateCbRow(repoSlug, { status: 'error', remarks: res.message, selected: false });
        break;
      default:
        this.updateCbRow(repoSlug, { status: 'error', remarks: res.message });
    }
  }

  private updateCbRow(repoSlug: string, patch: Partial<BranchCreateRepoRow>): void {
    this.cbRepos.update((rows) =>
      rows.map((r) => (r.repo.slug === repoSlug ? { ...r, ...patch } : r)),
    );
  }

  getCbStatusIcon(status: string): string {
    const map: Record<string, string> = {
      'source-ok': 'check_circle',
      created: 'task_alt',
      'already-exists': 'info',
      'source-missing': 'cancel',
      error: 'error',
      validating: 'sync',
      creating: 'sync',
    };
    return map[status] ?? 'radio_button_unchecked';
  }

  getCbStatusClass(status: string): string {
    const map: Record<string, string> = {
      'source-ok': 'status-ok',
      created: 'status-created',
      'already-exists': 'status-exists',
      'source-missing': 'status-missing',
      error: 'status-error',
      validating: 'status-validating',
      creating: 'status-validating',
    };
    return map[status] ?? 'status-idle';
  }
}
