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

export interface GroupedAppRow {
  appName: string;
  repository: string;
  resolvedProject: string;
  envs: { [envName: string]: ArgoAppModel };
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
  envColumns: string[] = [];

  dataSource = new MatTableDataSource<GroupedAppRow>([]);
  displayedColumns = ['select', 'appName'];

  // Row selection — max 1
  selectedRows: Set<GroupedAppRow> = new Set();

  // Filters
  filterValues: { [key: string]: string } = { appName: '' };

  // Plain number — updated manually after filter so it is always accurate
  totalRows = 0;

  get hasActiveFilters(): boolean {
    return Object.values(this.filterValues).some(val => val !== '');
  }

  hasExactlyTwoEnvs(): boolean {
    if (this.selectedRows.size !== 1) return false;
    const row = Array.from(this.selectedRows)[0];
    return Object.keys(row.envs).length === 2;
  }

  hasMultipleEnvs(): boolean {
    if (this.selectedRows.size !== 1) return false;
    const row = Array.from(this.selectedRows)[0];
    return Object.keys(row.envs).length >= 2;
  }

  get canCompare(): boolean {
    return this.hasMultipleEnvs();
  }

  get defaultBranch(): string {
    return this.authConfig.config().bitbucketDefaultBranch || 'main';
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
    this.dataSource.filterPredicate = (data: GroupedAppRow, filter: string) => {
      const terms = JSON.parse(filter);
      return Object.keys(terms).every(col => {
        const term = terms[col]?.toString().toLowerCase() || '';
        if (!term) return true;
        
        if (col === 'appName') {
          return data.appName.toLowerCase().includes(term) || data.repository.toLowerCase().includes(term);
        }
        
        const envApp = data.envs[col];
        if (!envApp) return false;
        return envApp.syncTag?.toLowerCase().includes(term) || false;
      });
    };
  }

  ngOnInit(): void { }

  // ── Environment chips ──────────────────────────────────────────────────────

  toggleEnv(env: EnvSelection) {
    env.selected = !env.selected;
    this.refresh();
  }

  // ── Row selection (max 1 row for comparison) ───────────────────────────────

  isRowSelected(row: GroupedAppRow): boolean {
    return this.selectedRows.has(row);
  }

  toggleRowSelection(row: GroupedAppRow) {
    if (this.selectedRows.has(row)) {
      this.selectedRows.delete(row);
    } else {
      this.selectedRows.add(row);
    }
  }

  // ── Compare: open side-by-side dialog ─────────────────────────────────────

  openCompare() {
    const rows = Array.from(this.selectedRows);
    if (rows.length !== 1) return;
    const envApps = Object.values(rows[0].envs);
    if (envApps.length < 2) return;

    this.dialog.open(ArgocdCompareDialogComponent, {
      width: '900px',
      maxHeight: '90vh',
      data: { apps: envApps },
      panelClass: 'dark-dialog'
    });
  }

  // ── Navigate to Branch-Compare with pre-filled state ──────────────────────

  navigateToCompare() {
    const rows = Array.from(this.selectedRows);
    if (rows.length === 0) return;

    const preFills: import('../../core/services/branch-compare-state.service').BranchComparePreFill[] = [];
    let hasTooManyEnvs = false;

    for (const row of rows) {
      const envApps = Object.values(row.envs);

      if (!row.resolvedProject || row.repository === 'Unknown') {
        this.notify.error(`Skipping "${row.appName}": Could not resolve service project.`);
        continue;
      }

      if (envApps.length > 2) {
        hasTooManyEnvs = true;
        continue;
      }

      if (envApps.length === 2) {
        preFills.push({
          project: row.resolvedProject,
          repository: row.repository,
          fromRef: envApps[0].syncTag,
          fromType: 'tag',
          toRef: envApps[1].syncTag,
          toType: 'tag',
        });
      } else if (envApps.length === 1) {
        const defaultBranch = this.authConfig.config().bitbucketDefaultBranch || 'main';
        preFills.push({
          project: row.resolvedProject,
          repository: row.repository,
          fromRef: envApps[0].syncTag,
          fromType: 'tag',
          toRef: defaultBranch,
          toType: 'branch',
        });
      }
    }

    if (hasTooManyEnvs) {
      this.notify.error('Please select exactly two environments or one environment for compare gap.');
    }

    if (preFills.length === 0) {
      if (!hasTooManyEnvs) {
        this.notify.error('No environment data available for comparison.');
      }
      return;
    }

    this.compareState.set(preFills);
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
      const registry = this.authConfig.serviceRegistry();
      const groupedMap = new Map<string, GroupedAppRow>();

      results.forEach((apps, idx) => {
        const envName = selectedEnvs[idx].config.name?.trim().toUpperCase() || 'UNKNOWN';

        let filteredApps = apps;
        if (envName === 'HMG PROD') {
          filteredApps = apps.filter(a => a.namespace === 'vida-prod');
        } else if (envName === 'HMG PRE-PROD') {
          filteredApps = apps.filter(a => a.namespace === 'vida-uat');
        }

        filteredApps.forEach(app => {
          app.envName = envName;
          const resolved = resolveServices([app.name], registry);
          
          let id = app.name;
          let appName = app.name;
          let repository = 'Unknown';
          let resolvedProject = '';

          if (resolved.ok) {
            id = resolved.result.repository;
            appName = resolved.result.displayName || app.name;
            repository = resolved.result.repository;
            resolvedProject = resolved.result.project;
          }

          if (!groupedMap.has(id)) {
            groupedMap.set(id, { appName, repository, resolvedProject, envs: {} });
          }

          groupedMap.get(id)!.envs[envName] = app;
        });
      });

      let groupedRows = Array.from(groupedMap.values());
      groupedRows.sort((a, b) => a.appName.localeCompare(b.appName));

      this.dataSource.data = groupedRows as any;
      
      this.envColumns = selectedEnvs.map(e => e.config.name?.trim().toUpperCase() || 'UNKNOWN');
      this.displayedColumns = ['select', 'appName', ...this.envColumns];
      
      this.envColumns.forEach(col => {
        if (!(col in this.filterValues)) {
          this.filterValues[col] = '';
        }
      });

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
    this.filterValues = { appName: '' };
    this.envColumns.forEach(col => this.filterValues[col] = '');
    this.applyFilter();
  }

  getHealthClass(app: ArgoAppModel): string {
    if (app.healthStatus === 'Degraded') return 'status-degraded';
    if (app.healthStatus === 'Missing') return 'status-missing';
    if (app.healthStatus === 'Progressing') return 'status-progressing';
    if (app.syncStatus === 'OutOfSync') return 'status-out-of-sync';
    return 'status-healthy';
  }

  getTooltip(app: ArgoAppModel): string {
    return `Health: ${app.healthStatus} | Sync: ${app.syncStatus}\nSynced At: ${this.formatDate(app.lastSyncedAt)}`;
  }

  formatDate(isoString: string): string {
    if (!isoString) return '—';
    return new Date(isoString).toLocaleString();
  }

  copyToClipboard(text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.notify.success('Copied to clipboard: ' + text);
    }).catch(err => {
      this.notify.error('Failed to copy: ' + err);
    });
  }

  copyAsConfluenceTable() {
    const selected = Array.from(this.selectedRows);
    if (selected.length === 0) {
      this.notify.error('Please select at least one application.');
      return;
    }

    const envs = this.envColumns;
    const thStyle = 'border:1px solid #ccc;padding:6px 10px;background:#f4f5f7;font-weight:600;text-align:left;color:#333;';
    const tdStyle = 'border:1px solid #ccc;padding:6px 10px;vertical-align:top;';

    // Header: App Name + Env Names
    const headerCells = ['Application Name', ...envs]
      .map(h => `<th style="${thStyle}">${h}</th>`).join('');

    const rowsHtml = selected.map(row => {
      const envCells = envs.map(env => {
        const tag = row.envs[env]?.syncTag || '—';
        return `<td style="${tdStyle}">${tag}</td>`;
      }).join('');

      return `<tr>
        <td style="${tdStyle}"><strong>${row.appName}</strong></td>
        ${envCells}
      </tr>`;
    }).join('');

    const html = `
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;

    const plain = [
      ['Application Name', ...envs].join('\t'),
      ...selected.map(row => [
        row.appName,
        ...envs.map(env => row.envs[env]?.syncTag || '—')
      ].join('\t'))
    ].join('\n');

    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      });
      navigator.clipboard.write([item]).then(() => {
        this.notify.success(`Copied ${selected.length} apps as a Confluence table!`);
      }).catch(() => this.notify.error('Failed to copy to clipboard.'));
    } catch {
      navigator.clipboard.writeText(plain).then(() => {
        this.notify.success(`Copied ${selected.length} apps (plain text fallback).`);
      }).catch(() => this.notify.error('Failed to copy to clipboard.'));
    }
  }
}
