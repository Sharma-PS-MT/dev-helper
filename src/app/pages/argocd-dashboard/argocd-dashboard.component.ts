import { Component, OnInit, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { RouterModule, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthConfigService, ArgocdEnvConfig } from '../../core/services/auth-config.service';
import { ArgocdService, ArgoAppModel } from '../../core/services/argocd.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchCompareStateService } from '../../core/services/branch-compare-state.service';
import { resolveServices } from '../../core/config/service-registry';
import { ArgocdCompareDialogComponent } from './argocd-compare-dialog.component';

interface EnvSelection {
  config: ArgocdEnvConfig;
  selected: boolean;
  loading: boolean;
  error: string | null;
}

@Component({
  selector: 'app-argocd-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    MatCardModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatCheckboxModule, MatTableModule, MatSelectModule,
    MatInputModule, MatFormFieldModule, MatChipsModule, MatTooltipModule, MatDialogModule
  ],
  templateUrl: './argocd-dashboard.component.html',
  styleUrls: ['./argocd-dashboard.component.scss']
})
export class ArgocdDashboardComponent implements OnInit {
  envs = signal<EnvSelection[]>([]);

  dataSource = new MatTableDataSource<ArgoAppModel>([]);
  displayedColumns = ['select', 'envName', 'name', 'namespace', 'syncStatus', 'healthStatus', 'syncTag', 'lastSyncedAt'];

  // Row selection — max 2
  selectedRows: Set<ArgoAppModel> = new Set();

  // Filters
  filterValues: { [key: string]: string } = {
    envName: '', name: '', namespace: '', syncStatus: '', healthStatus: '', syncTag: ''
  };

  syncStatuses = ['Synced', 'OutOfSync', 'Unknown'];
  healthStatuses = ['Healthy', 'Degraded', 'Progressing', 'Suspended', 'Missing', 'Unknown'];

  // Plain number — updated manually after filter so it is always accurate
  totalRows = 0;

  get hasActiveFilters(): boolean {
    return Object.values(this.filterValues).some(val => val !== '');
  }

  get canCompare(): boolean {
    return this.selectedRows.size === 2;
  }

  constructor(
    private authConfig: AuthConfigService,
    private argocd: ArgocdService,
    private dialog: MatDialog,
    private router: Router,
    private notify: NotificationService,
    private compareState: BranchCompareStateService
  ) {
    // Sync env list from Firebase signal — use untracked to avoid loop
    effect(() => {
      const globalEnvs = this.authConfig.argocdEnvs();
      const currentEnvs = untracked(() => this.envs());
      const merged = globalEnvs.map(env => {
        const existing = currentEnvs.find(e => e.config.id === env.id);
        return existing || { config: env, selected: false, loading: false, error: null };
      });
      this.envs.set(merged);
    }, { allowSignalWrites: true });

    // Multi-column AND filter predicate
    this.dataSource.filterPredicate = (data: ArgoAppModel, filter: string) => {
      const terms = JSON.parse(filter);
      return Object.keys(terms).every(col => {
        const term = terms[col]?.toString().toLowerCase() || '';
        if (!term) return true;
        return (data as any)[col]?.toString().toLowerCase().includes(term);
      });
    };
  }

  ngOnInit(): void {}

  // ── Environment chips ──────────────────────────────────────────────────────

  toggleEnv(env: EnvSelection) {
    env.selected = !env.selected;
    this.refresh();
  }

  // ── Row selection (max 2) ──────────────────────────────────────────────────

  isRowSelected(row: ArgoAppModel): boolean {
    return this.selectedRows.has(row);
  }

  toggleRowSelection(row: ArgoAppModel) {
    if (this.selectedRows.has(row)) {
      this.selectedRows.delete(row);
    } else {
      if (this.selectedRows.size >= 2) return;
      this.selectedRows.add(row);
    }
  }

  // ── Compare: open side-by-side dialog ─────────────────────────────────────

  openCompare() {
    const [appA, appB] = Array.from(this.selectedRows);
    this.dialog.open(ArgocdCompareDialogComponent, {
      width: '900px',
      maxHeight: '90vh',
      data: { appA, appB },
      panelClass: 'dark-dialog'
    });
  }

  // ── Navigate to Branch-Compare with pre-filled state ──────────────────────

  navigateToCompare() {
    const apps = Array.from(this.selectedRows);
    // Resolve via registry — works for 1 or 2 apps
    const serviceNames = apps.map(a => a.name);
    const resolved = resolveServices(serviceNames);

    if (!resolved.ok) {
      this.notify.error(resolved.error);
      return;
    }

    if (apps.length === 2) {
      // Two apps: compare their sync tags against each other
      this.compareState.set({
        project:    resolved.result.project,
        repository: resolved.result.repository,
        fromRef:    apps[0].syncTag,
        fromType:   'tag',
        toRef:      apps[1].syncTag,
        toType:     'tag',
      });
    } else {
      // One app: compare its sync tag against main
      this.compareState.set({
        project:    resolved.result.project,
        repository: resolved.result.repository,
        fromRef:    apps[0].syncTag,
        fromType:   'tag',
        toRef:      'main',
        toType:     'branch',
      });
    }

    this.router.navigate(['/branch-compare']);
  }

  // ── Data fetching ──────────────────────────────────────────────────────────

  refresh() {
    this.selectedRows.clear();
    const selectedEnvs = this.envs().filter(e => e.selected);
    if (selectedEnvs.length === 0) {
      this.dataSource.data = [];
      this.totalRows = 0;
      return;
    }

    const requests = selectedEnvs.map(env => {
      env.loading = true;
      env.error = null;
      return this.argocd.fetchApplicationsForEnv(env.config).pipe(
        catchError(err => {
          env.error = err.message || 'Connection failed';
          return of([] as ArgoAppModel[]);
        })
      );
    });

    forkJoin(requests).subscribe(results => {
      const allApps = results.flat();
      this.dataSource.data = allApps;
      this.applyFilter();

      this.envs.update(envs => {
        envs.forEach(e => { if (e.selected) e.loading = false; });
        return [...envs];
      });
    });
  }

  applyFilter() {
    this.dataSource.filter = JSON.stringify(this.filterValues);
    // setTimeout ensures filteredData is settled before we read length
    setTimeout(() => { this.totalRows = this.dataSource.filteredData.length; });
  }

  clearFilters() {
    Object.keys(this.filterValues).forEach(key => this.filterValues[key] = '');
    this.applyFilter();
  }

  formatDate(isoString: string): string {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString();
  }
}
