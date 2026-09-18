import {
  Component,
  OnInit,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthConfigService, KeycloakEnvConfig } from '../../core/services/auth-config.service';
import {
  FeatureToggleService,
  FeatureFlag,
  FeatureFlagMetadata,
} from '../../core/services/feature-toggle.service';
import { NotificationService } from '../../core/services/notification.service';

export interface EnvToggleSelection {
  config: KeycloakEnvConfig;
  selected: boolean;
  loading: boolean;
  error: string | null;
}

export type ToggleDisplayState = 'ENABLED' | 'PARTIALLY_ENABLED' | 'DISABLED' | 'NOT_FOUND';

export interface EnvCellState {
  state: ToggleDisplayState;
  hospitalIds?: number[];
  flagObj?: FeatureFlag;
}

export interface ToggleCompareRow {
  flagName: string;
  metadata?: FeatureFlagMetadata;
  envStates: { [envName: string]: EnvCellState };
  hasDifference: boolean;
}

@Component({
  selector: 'app-feature-toggles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatChipsModule,
    MatMenuModule,
  ],
  templateUrl: './feature-toggles.component.html',
  styleUrls: ['./feature-toggles.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class FeatureTogglesComponent implements OnInit {
  private authConfig = inject(AuthConfigService);
  private toggleService = inject(FeatureToggleService);
  private notify = inject(NotificationService);

  envs = signal<EnvToggleSelection[]>([]);

  // Selected environment columns for dynamic table view
  envColumns = signal<string[]>([]);

  // Rows of comparison data
  allRows = signal<ToggleCompareRow[]>([]);

  // Filter and search
  searchTerm = signal<string>('');
  filterType = signal<'all' | 'diff' | 'enabled' | 'partial' | 'disabled'>('all');
  selectedCategory = signal<string>('all'); // toggleType filter

  // Cache of flags per environment: envName -> FeatureFlag[]
  private envCache = new Map<string, FeatureFlag[]>();

  // Computed summary metrics
  totalFlags = computed(() => this.allRows().length);
  differingFlagsCount = computed(() => this.allRows().filter((r) => r.hasDifference).length);
  selectedEnvCount = computed(() => this.envs().filter((e) => e.selected).length);

  availableCategories = computed(() => {
    const cats = new Set<string>();
    for (const r of this.allRows()) {
      if (r.metadata?.toggleType) {
        cats.add(r.metadata.toggleType);
      }
    }
    return Array.from(cats).sort();
  });

  // Filtered rows for the table
  filteredRows = computed(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const type = this.filterType();
    const category = this.selectedCategory();
    const selectedCols = this.envColumns();

    return this.allRows().filter((row) => {
      // Search term
      if (search) {
        const matchesName = row.flagName.toLowerCase().includes(search);
        const matchesDesc = row.metadata?.description?.toLowerCase().includes(search) || false;
        const matchesTicket = row.metadata?.ticketId?.toLowerCase().includes(search) || false;
        if (!matchesName && !matchesDesc && !matchesTicket) {
          return false;
        }
      }

      // Category / toggleType
      if (category !== 'all') {
        if (row.metadata?.toggleType?.toLowerCase() !== category.toLowerCase()) {
          return false;
        }
      }

      // Filter type
      if (type === 'diff') {
        if (!row.hasDifference) return false;
      } else if (type === 'enabled') {
        const anyEnabled = selectedCols.some((col) => row.envStates[col]?.state === 'ENABLED');
        if (!anyEnabled) return false;
      } else if (type === 'partial') {
        const anyPartial = selectedCols.some(
          (col) => row.envStates[col]?.state === 'PARTIALLY_ENABLED',
        );
        if (!anyPartial) return false;
      } else if (type === 'disabled') {
        const anyDisabled = selectedCols.some(
          (col) => row.envStates[col]?.state === 'DISABLED',
        );
        if (!anyDisabled) return false;
      }

      return true;
    });
  });

  constructor() {
    // Synchronize environments with authConfig.keycloakEnvs()
    effect(
      () => {
        const globalEnvs = this.authConfig.keycloakEnvs() || [];
        const current = untracked(() => this.envs());

        const merged: EnvToggleSelection[] = globalEnvs.map((cfg) => {
          const found = current.find((c) => c.config.envName === cfg.envName);
          return (
            found || {
              config: cfg,
              selected: false,
              loading: false,
              error: null,
            }
          );
        });

        this.envs.set(merged);
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {}

  toggleEnv(env: EnvToggleSelection) {
    const isNowSelected = !env.selected;
    
    // Update envs signal with new selected state
    this.envs.update((list) =>
      list.map((item) =>
        item.config.envName === env.config.envName
          ? { ...item, selected: isNowSelected }
          : item,
      ),
    );

    if (!isNowSelected) {
      this.rebuildTable();
    } else {
      if (this.envCache.has(env.config.envName)) {
        this.rebuildTable();
      } else {
        const currentEnv = this.envs().find((e) => e.config.envName === env.config.envName) || env;
        this.loadEnvData(currentEnv);
      }
    }
  }

  selectAllEnvs() {
    const updated = this.envs().map((e) => ({ ...e, selected: true }));
    this.envs.set(updated);
    this.refreshAllSelected();
  }

  clearEnvSelection() {
    const updated = this.envs().map((e) => ({ ...e, selected: false }));
    this.envs.set(updated);
    this.rebuildTable();
  }

  loadEnvData(env: EnvToggleSelection) {
    if (!env.config.baseUrl) {
      this.envs.update((list) =>
        list.map((item) =>
          item.config.envName === env.config.envName
            ? { ...item, error: 'Base URL not configured in IAM config.' }
            : item,
        ),
      );
      this.notify.error(`Cannot fetch ${env.config.envName}: Base URL is missing.`);
      return;
    }

    this.envs.update((list) =>
      list.map((item) =>
        item.config.envName === env.config.envName
          ? { ...item, loading: true, error: null }
          : item,
      ),
    );

    this.toggleService.fetchFeatureFlags(env.config).subscribe({
      next: (flags) => {
        this.envs.update((list) =>
          list.map((item) =>
            item.config.envName === env.config.envName
              ? { ...item, loading: false, error: null }
              : item,
          ),
        );
        this.envCache.set(env.config.envName, flags);
        this.rebuildTable();
      },
      error: (err) => {
        const errorMsg = err?.error?.detail || err?.error?.message || err?.message || 'Failed to fetch feature flags';
        this.envs.update((list) =>
          list.map((item) =>
            item.config.envName === env.config.envName
              ? { ...item, loading: false, error: errorMsg }
              : item,
          ),
        );
        this.notify.error(`[${env.config.envName}] ${errorMsg}`);
        this.rebuildTable();
      },
    });
  }

  refreshAllSelected() {
    const selected = this.envs().filter((e) => e.selected);
    if (selected.length === 0) return;

    this.envs.update((list) =>
      list.map((item) =>
        item.selected ? { ...item, loading: true, error: null } : item,
      ),
    );

    const requests = selected.map((env) =>
      this.toggleService.fetchFeatureFlags(env.config).pipe(
        catchError((err) => {
          env.error = err?.error?.message || err?.message || 'Failed to fetch';
          return of<FeatureFlag[]>([]);
        }),
      ),
    );

    forkJoin(requests).subscribe((results) => {
      const errorMap = new Map<string, string | null>();
      results.forEach((flags, idx) => {
        const env = selected[idx];
        if (!env.error) {
          this.envCache.set(env.config.envName, flags);
          errorMap.set(env.config.envName, null);
        } else {
          errorMap.set(env.config.envName, env.error);
        }
      });

      this.envs.update((list) =>
        list.map((item) =>
          item.selected
            ? {
                ...item,
                loading: false,
                error: errorMap.has(item.config.envName)
                  ? errorMap.get(item.config.envName)!
                  : item.error,
              }
            : item,
        ),
      );

      this.rebuildTable();
      this.notify.success('Feature flags refreshed for selected environments.');
    });
  }

  private determineState(flag?: FeatureFlag): EnvCellState {
    if (!flag) {
      return { state: 'NOT_FOUND' };
    }

    const stateUpper = (flag.state || '').toUpperCase();
    const targetStatus = flag.target?.status;
    const hospitalIds = flag.target?.hospitalIds;

    // Requirement: under target if hospitalIds is present then show state partially enabled with different color and hospitalIds in info
    if (hospitalIds && hospitalIds.length > 0) {
      return {
        state: 'PARTIALLY_ENABLED',
        hospitalIds: hospitalIds,
        flagObj: flag,
      };
    }

    if (stateUpper === 'ENABLED' && targetStatus !== false) {
      return {
        state: 'ENABLED',
        flagObj: flag,
      };
    }

    return {
      state: 'DISABLED',
      flagObj: flag,
    };
  }

  private rebuildTable() {
    const selectedEnvs = this.envs().filter((e) => e.selected);
    const cols = selectedEnvs.map((e) => e.config.envName);
    this.envColumns.set(cols);

    if (cols.length === 0) {
      this.allRows.set([]);
      return;
    }

    // Collect all unique flag names across all selected and cached envs
    const flagNamesMap = new Map<string, { metadata?: FeatureFlagMetadata }>();

    for (const col of cols) {
      const flags = this.envCache.get(col) || [];
      for (const f of flags) {
        if (!flagNamesMap.has(f.flag)) {
          flagNamesMap.set(f.flag, { metadata: f.metadata });
        } else if (!flagNamesMap.get(f.flag)?.metadata && f.metadata) {
          flagNamesMap.get(f.flag)!.metadata = f.metadata;
        }
      }
    }

    const sortedNames = Array.from(flagNamesMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );

    const rows: ToggleCompareRow[] = [];

    for (const flagName of sortedNames) {
      const metadata = flagNamesMap.get(flagName)?.metadata;
      const envStates: { [envName: string]: EnvCellState } = {};

      const distinctEffectiveStates = new Set<string>();

      for (const col of cols) {
        const flags = this.envCache.get(col) || [];
        const found = flags.find((f) => f.flag === flagName);
        const cell = this.determineState(found);
        envStates[col] = cell;

        // If target has hospitalIds, consider hospitalIds as part of state differentiation too
        const stateKey =
          cell.state === 'PARTIALLY_ENABLED'
            ? `PARTIAL_${(cell.hospitalIds || []).sort().join(',')}`
            : cell.state;
        distinctEffectiveStates.add(stateKey);
      }

      // If more than 1 distinct state across selected environments, row is a diff
      const hasDifference = cols.length > 1 && distinctEffectiveStates.size > 1;

      rows.push({
        flagName,
        metadata,
        envStates,
        hasDifference,
      });
    }

    this.allRows.set(rows);
  }

  // Copy differences or whole table as Markdown/CSV
  copyComparisonSummary() {
    const cols = this.envColumns();
    if (cols.length === 0) return;

    let csv = `Flag Name,Toggle Type,Description,Ticket,${cols.join(',')}\n`;
    for (const row of this.filteredRows()) {
      const meta = row.metadata || {};
      const desc = (meta.description || '').replace(/"/g, '""');
      const ticket = meta.ticketId || '';
      const type = meta.toggleType || '';

      const states = cols
        .map((c) => {
          const st = row.envStates[c];
          if (!st) return 'N/A';
          if (st.state === 'PARTIALLY_ENABLED') {
            return `PARTIAL(${st.hospitalIds?.join(';') || ''})`;
          }
          return st.state;
        })
        .join(',');

      csv += `"${row.flagName}","${type}","${desc}","${ticket}",${states}\n`;
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(csv).then(() => {
        this.notify.success('Exported comparison table copied to clipboard (CSV format)!');
      });
    }
  }
}
