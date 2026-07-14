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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  BitbucketProject,
  BitbucketRepo,
  PRCreationResult,
} from '../../core/models/bitbucket.models';
import { of, forkJoin } from 'rxjs';
import { catchError } from 'rxjs/operators';

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
  ],
  templateUrl: './pr-creation.component.html',
  styleUrls: ['./pr-creation.component.scss'],
})
export class PrCreationComponent implements OnInit {
  // ─── Projects ────────────────────────────────────────────────────────────────
  projects = signal<BitbucketProject[]>([]);
  loadingProjects = signal(false);

  projectSearch = signal('');

  filteredProjects = computed(() => {
    const t = this.projectSearch().toLowerCase();
    return this.projects().filter(
      p =>
        (p.name || '').toLowerCase().includes(t) ||
        (p.key || '').toLowerCase().includes(t)
    );
  });

  // ─── PR Creation Panel ────────────────────────────────────────────────────────
  // Branch inputs
  createSourceBranch = signal('');
  createTargetBranch = signal('');
  createPRTitle = signal('');
  createPRDescription = signal('');

  // Project / repo selection
  selectedProject = signal<string | null>(null);
  repos = signal<PRCreateRepoRow[]>([]);
  loadingRepos = signal(false);
  creatingPRs = signal(false);
  validatingBranches = signal(false);

  /** True when all rows have been validated (no idle/validating) */
  validationDone = computed(
    () =>
      this.repos().length > 0 &&
      this.repos().every(r => r.status !== 'idle' && r.status !== 'validating')
  );

  /** Count of rows with status 'ok' */
  validCount = computed(() => this.repos().filter(r => r.status === 'ok').length);

  /** Whether the Make PR button should be enabled */
  canMakePRs = computed(
    () =>
      !this.creatingPRs() &&
      this.validationDone() &&
      this.repos().some(r => r.selected && r.status === 'ok')
  );

  allSelected = computed(
    () =>
      this.repos().length > 0 &&
      this.repos().filter(r => r.status === 'ok').every(r => r.selected)
  );

  someSelected = computed(
    () => this.repos().some(r => r.selected) && !this.allSelected()
  );

  // ─── Summary counts (computed for template) ────────────────────────────────
  countOk = computed(() => this.repos().filter(r => r.status === 'ok').length);
  countMissing = computed(
    () =>
      this.repos().filter(
        r => r.status === 'source-missing' || r.status === 'target-missing'
      ).length
  );
  countExists = computed(() => this.repos().filter(r => r.status === 'exists').length);
  countCreated = computed(() => this.repos().filter(r => r.status === 'created').length);
  countError = computed(() => this.repos().filter(r => r.status === 'error').length);

  constructor(
    private bitbucket: BitbucketService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  // ─── Project loading ──────────────────────────────────────────────────────────
  loadProjects(): void {
    this.loadingProjects.set(true);
    this.bitbucket.getProjects().subscribe({
      next: px => {
        this.projects.set(px);
        this.loadingProjects.set(false);
      },
      error: () => {
        this.notify.error('Failed to load projects');
        this.loadingProjects.set(false);
      },
    });
  }

  // ─── Project change ───────────────────────────────────────────────────────────
  onProjectChange(key: string): void {
    this.selectedProject.set(key);
    this.repos.set([]);
    this.loadingRepos.set(true);
    this.bitbucket.getRepositories(key).subscribe({
      next: rx => {
        this.repos.set(
          rx.map(repo => ({
            repo,
            selected: true,
            status: 'idle',
            remarks: '',
            prId: null,
            prUrl: null,
          }))
        );
        this.loadingRepos.set(false);
      },
      error: () => {
        this.notify.error('Failed to load repositories');
        this.loadingRepos.set(false);
      },
    });
  }

  // ─── Select All checkbox ─────────────────────────────────────────────────────
  toggleSelectAll(checked: boolean): void {
    this.repos.update(rows =>
      rows.map(r => ({ ...r, selected: r.status === 'ok' ? checked : r.selected }))
    );
  }

  toggleRowSelect(repo: BitbucketRepo, checked: boolean): void {
    this.repos.update(rows =>
      rows.map(r => (r.repo.slug === repo.slug ? { ...r, selected: checked } : r))
    );
  }

  // ─── Validate branches (lightweight — no PR creation) ────────────────────────
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
    // Reset all rows to validating state
    this.repos.update(rows =>
      rows.map(r => ({
        ...r,
        status: 'validating',
        remarks: '',
        prId: null,
        prUrl: null,
      }))
    );

    const repoList = this.repos();
    let completed = 0;

    repoList.forEach(row => {
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

  // ─── Make PRs ────────────────────────────────────────────────────────────────
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

    const targetRows = this.repos().filter(r => r.selected && r.status === 'ok');
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

      this.bitbucket
        .createPullRequest(projKey, row.repo.slug, src, tgt, title, description)
        .subscribe({
          next: res => {
            this.applyResult(row.repo.slug, res);
            if (res.status === 'created') createdCount++;
            if (res.status === 'already_exists') skippedCount++;
            completed++;
            if (completed === targetRows.length) {
              this.creatingPRs.set(false);
              this.notify.success(
                `Done! ${createdCount} PR(s) created, ${skippedCount} skipped (already exist).`
              );
            }
          },
          error: err => {
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

  // ─── Reset ───────────────────────────────────────────────────────────────────
  resetResults(): void {
    this.repos.update(rows =>
      rows.map(r => ({
        ...r,
        status: 'idle',
        remarks: '',
        prId: null,
        prUrl: null,
        selected: true,
      }))
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

  // ─── Helpers ─────────────────────────────────────────────────────────────────
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
        this.updateRow(repoSlug, {
          status: 'error',
          remarks: res.message,
          selected: false,
        });
        break;
      default:
        this.updateRow(repoSlug, { status: 'ok', remarks: 'Branches found' });
    }
  }

  private updateRow(repoSlug: string, patch: Partial<PRCreateRepoRow>): void {
    this.repos.update(rows =>
      rows.map(r => (r.repo.slug === repoSlug ? { ...r, ...patch } : r))
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
}
