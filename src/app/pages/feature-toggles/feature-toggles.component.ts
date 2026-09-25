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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthConfigService, KeycloakEnvConfig } from '../../core/services/auth-config.service';
import {
  FeatureToggleService,
  FeatureFlag,
  FeatureFlagMetadata,
  Hospital,
} from '../../core/services/feature-toggle.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  HospitalDetailsDialogComponent,
  HospitalDialogData,
} from './hospital-details-dialog.component';

export interface EnvToggleSelection {
  config: KeycloakEnvConfig;
  selected: boolean;
  loading: boolean;
  error: string | null;
}

export type ToggleDisplayState = 'ENABLED' | 'PARTIALLY_ENABLED' | 'DISABLED' | 'NOT_FOUND';

export interface EnvCellState {
  state: ToggleDisplayState;
  hospitalIds?: (number | string)[];
  flagObj?: FeatureFlag;
}

export interface ToggleCompareRow {
  flagName: string;
  metadata?: FeatureFlagMetadata;
  envStates: { [envName: string]: EnvCellState };
  hasDifference: boolean;
}

/** One visible column in the comparison table (original or duplicate). */
export interface DisplayColumn {
  /** Unique render key (e.g. 'dev', 'dev__dup_2') */
  columnKey: string;
  /** Actual environment name used for data lookup */
  envName: string;
  /** Label shown in the header (e.g. 'DEV', 'DEV (2)') */
  label: string;
  /** Selected hospital ID for the lens filter, or null = no filter */
  selectedHospitalId: string | null;
  /** True for cloned columns; originals cannot be removed */
  isDuplicate: boolean;
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
    MatDialogModule,
  ],
  templateUrl: './feature-toggles.component.html',
  styleUrls: ['./feature-toggles.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class FeatureTogglesComponent implements OnInit {
  private authConfig = inject(AuthConfigService);
  private toggleService = inject(FeatureToggleService);
  private notify = inject(NotificationService);
  private dialog = inject(MatDialog);

  envs = signal<EnvToggleSelection[]>([]);

  // Selected environment columns for dynamic table view
  envColumns = signal<string[]>([]);

  // Visible display columns — one entry per rendered table column (orig + duplicates)
  displayColumns = signal<DisplayColumn[]>([]);

  // Rows of comparison data
  allRows = signal<ToggleCompareRow[]>([]);

  // Filter and search for feature flags
  searchTerm = signal<string>('');
  filterType = signal<'all' | 'diff' | 'enabled' | 'partial' | 'disabled'>('all');
  selectedCategory = signal<string>('all'); // toggleType filter

  // Cache of flags per environment: envName -> FeatureFlag[]
  private envCache = new Map<string, FeatureFlag[]>();

  // Cache of hospitals per environment as a reactive signal
  hospitalCache = signal<Map<string, Hospital[]>>(new Map());

  // Computed summary metrics
  totalFlags = computed(() => this.allRows().length);
  differingFlagsCount = computed(() => this.allRows().filter((r) => r.hasDifference).length);
  selectedEnvCount = computed(() => this.envs().filter((e) => e.selected).length);

  // Fast map lookup: id -> Hospital (derived from reactive hospitalCache signal)
  hospitalMap = computed<Map<string, Hospital>>(() => {
    const cols = this.envColumns();
    const cache = this.hospitalCache();
    const map = new Map<string, Hospital>();

    for (const col of cols) {
      const list = cache.get(col) || [];
      for (const h of list) {
        if (h && h.id !== undefined && h.id !== null) {
          const key = String(h.id).trim();
          if (!map.has(key)) {
            map.set(key, { id: h.id, hospitalName: h.hospitalName });
          }
        }
      }
    }
    return map;
  });

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
      if (this.envCache.has(env.config.envName) && this.hospitalCache().has(env.config.envName)) {
        this.rebuildTable();
      } else {
        const currentEnv = this.envs().find((e) => e.config.envName === env.config.envName) || env;
        this.loadEnvData(currentEnv);
      }
    }
  }


  clearEnvSelection() {
    const updated = this.envs().map((e) => ({ ...e, selected: false }));
    this.envs.set(updated);
    this.rebuildTable();
  }

  /** Clone an env column; the duplicate gets its own independent hospital filter. */
  duplicateColumn(col: DisplayColumn): void {
    const envCols = this.displayColumns().filter((d) => d.envName === col.envName);
    const nextIndex = envCols.length + 1;

    const dup: DisplayColumn = {
      columnKey: `${col.envName}__dup_${nextIndex}`,
      envName: col.envName,
      label: `${col.envName.toUpperCase()} (${nextIndex})`,
      selectedHospitalId: null,
      isDuplicate: true,
    };

    // Insert right after the last column that belongs to this env
    const all = [...this.displayColumns()];
    const lastIdx = all.reduce((acc, d, i) => (d.envName === col.envName ? i : acc), -1);
    all.splice(lastIdx + 1, 0, dup);
    this.displayColumns.set(all);
  }

  /** Remove a duplicate column (originals are protected). */
  removeColumn(col: DisplayColumn): void {
    if (!col.isDuplicate) return;
    this.displayColumns.update((cols) => cols.filter((d) => d.columnKey !== col.columnKey));
  }

  /** Set (or clear) the hospital filter lens for a specific display column. */
  setColumnHospitalFilter(col: DisplayColumn, hospitalId: string | null): void {
    this.displayColumns.update((cols) =>
      cols.map((d) =>
        d.columnKey === col.columnKey ? { ...d, selectedHospitalId: hospitalId || null } : d,
      ),
    );
  }

  /**
   * Compute the effective display state for a cell, applying the per-column
   * hospital lens if one is active.
   */
  getEffectiveState(cell: EnvCellState | undefined, hospitalId: string | null): ToggleDisplayState {
    if (!cell) return 'NOT_FOUND';
    if (!hospitalId) return cell.state; // no lens → raw state

    if (cell.state === 'PARTIALLY_ENABLED') {
      const ids = (cell.hospitalIds || []).map((id) => String(id).trim());
      return ids.includes(hospitalId) ? 'ENABLED' : 'DISABLED';
    }

    return cell.state; // ENABLED / DISABLED / NOT_FOUND unchanged
  }

  /** Get the sorted hospital list for a given environment (from cache). */
  getHospitalsForEnv(envName: string): Hospital[] {
    return this.hospitalCache().get(envName) || [];
  }

  /** Expose String() to the template for [value] binding. */
  readonly toStr = (id: number | string): string => String(id).trim();

  /** trackBy function for displayColumns ngFor. */
  trackByColumnKey(_: number, col: DisplayColumn): string {
    return col.columnKey;
  }

  /** Build Jira ticket browse URL from AuthConfig */
  getTicketUrl(ticketId?: string): string {
    if (!ticketId) return '#';
    const jiraBase = (this.authConfig.config().jiraBaseUrl || '').replace(/\/$/, '');
    if (!jiraBase) return '#';
    return `${jiraBase}/browse/${ticketId.trim()}`;
  }

  /** Open Jira ticket in a new browser tab */
  openTicket(ticketId?: string, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!ticketId) return;
    const jiraBase = (this.authConfig.config().jiraBaseUrl || '').replace(/\/$/, '');
    if (!jiraBase) {
      this.notify.warn('Jira Base URL is not configured. Please set it in Settings.');
      return;
    }
    window.open(`${jiraBase}/browse/${ticketId.trim()}`, '_blank', 'noopener,noreferrer');
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

    // Acquire token once and fetch flags + hospitals in parallel
    this.toggleService
      .acquireToken(env.config)
      .pipe(
        switchMap((tokenRes) => {
          const token = tokenRes.access_token;
          return forkJoin({
            flags: this.toggleService.fetchFeatureFlags(env.config, token),
            hospitals: this.toggleService.fetchHospitals(env.config, token).pipe(
              catchError((hospErr) => {
                console.warn(`[${env.config.envName}] Could not load hospitals:`, hospErr);
                return of<Hospital[]>([]);
              }),
            ),
          });
        }),
        catchError((err) => {
          return forkJoin({
            flags: this.toggleService.fetchFeatureFlags(env.config),
            hospitals: this.toggleService.fetchHospitals(env.config).pipe(catchError(() => of<Hospital[]>([]))),
          });
        }),
      )
      .subscribe({
        next: ({ flags, hospitals }) => {
          this.envs.update((list) =>
            list.map((item) =>
              item.config.envName === env.config.envName
                ? { ...item, loading: false, error: null }
                : item,
            ),
          );
          this.envCache.set(env.config.envName, flags);
          this.hospitalCache.update((c) => {
            const next = new Map(c);
            next.set(env.config.envName, hospitals);
            return next;
          });
          this.rebuildTable();
        },
        error: (err) => {
          const errorMsg =
            err?.error?.detail || err?.error?.message || err?.message || 'Failed to fetch environment data';
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
      this.toggleService.acquireToken(env.config).pipe(
        switchMap((tokenRes) => {
          const token = tokenRes.access_token;
          return forkJoin({
            envName: of(env.config.envName),
            flags: this.toggleService.fetchFeatureFlags(env.config, token),
            hospitals: this.toggleService.fetchHospitals(env.config, token).pipe(catchError(() => of<Hospital[]>([]))),
            error: of<string | null>(null),
          });
        }),
        catchError((err) => {
          return of({
            envName: env.config.envName,
            flags: [] as FeatureFlag[],
            hospitals: [] as Hospital[],
            error: err?.error?.message || err?.message || 'Failed to fetch',
          });
        }),
      ),
    );

    forkJoin(requests).subscribe((results) => {
      const errorMap = new Map<string, string | null>();
      const newHospitalMap = new Map(this.hospitalCache());

      results.forEach((res) => {
        if (!res.error) {
          this.envCache.set(res.envName, res.flags);
          newHospitalMap.set(res.envName, res.hospitals);
          errorMap.set(res.envName, null);
        } else {
          errorMap.set(res.envName, res.error);
        }
      });

      this.hospitalCache.set(newHospitalMap);

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
      this.notify.success('Feature flags & hospital masterdata refreshed for active environments.');
    });
  }

  private determineState(flag?: FeatureFlag): EnvCellState {
    if (!flag) {
      return { state: 'NOT_FOUND' };
    }

    const stateUpper = (flag.state || '').toUpperCase();
    const targetStatus = flag.target?.status;
    const hospitalIds = flag.target?.hospitalIds;

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

    // ── Sync displayColumns ─────────────────────────────────────────────
    // Keep duplicates for envs that are still selected; add originals for
    // newly selected envs; drop everything for deselected envs.
    const current = this.displayColumns();
    const newDisplay: DisplayColumn[] = [];

    for (const envName of cols) {
      const existing = current.filter((d) => d.envName === envName);
      if (existing.length > 0) {
        // Env already had columns (original + any duplicates) — keep them
        newDisplay.push(...existing);
      } else {
        // New environment selected — add a fresh original column
        newDisplay.push({
          columnKey: envName,
          envName,
          label: envName.toUpperCase(),
          selectedHospitalId: null,
          isDuplicate: false,
        });
      }
    }

    // Filter out columns whose environment was deselected
    this.displayColumns.set(newDisplay.filter((d) => cols.includes(d.envName)));
    // ────────────────────────────────────────────────────────────────────

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

        const stateKey =
          cell.state === 'PARTIALLY_ENABLED'
            ? `PARTIAL_${(cell.hospitalIds || []).sort().join(',')}`
            : cell.state;
        distinctEffectiveStates.add(stateKey);
      }

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

  getHospitalName(id: number | string): string {
    const key = String(id).trim();
    const found = this.hospitalMap().get(key);
    if (found && found.hospitalName) {
      return found.hospitalName;
    }
    return `Hospital #${id}`;
  }

  getHospitalTooltip(cell?: EnvCellState): string {
    if (!cell || !cell.hospitalIds || cell.hospitalIds.length === 0) {
      return 'Partially enabled (No specific hospital IDs specified)';
    }
    const ids = cell.hospitalIds;
    const lines = ids.map((id) => `• #${id} — ${this.getHospitalName(id)}`);
    return `Partially Enabled (${ids.length} targeted):\n${lines.join('\n')}\n(Click badge to inspect hospital)`;
  }

  openHospitalModal(hospitalOrId: Hospital | number | string): void {
    let targetHospital: Hospital;
    if (typeof hospitalOrId === 'number' || typeof hospitalOrId === 'string') {
      const key = String(hospitalOrId).trim();
      const found = this.hospitalMap().get(key);
      targetHospital = found || {
        id: typeof hospitalOrId === 'string' && !isNaN(Number(hospitalOrId)) ? Number(hospitalOrId) : hospitalOrId,
        hospitalName: this.getHospitalName(hospitalOrId),
      };
    } else {
      targetHospital = hospitalOrId;
    }

    const envFlagsMap: { [envName: string]: FeatureFlag[] } = {};
    for (const col of this.envColumns()) {
      envFlagsMap[col] = this.envCache.get(col) || [];
    }

    const dialogData: HospitalDialogData = {
      hospital: targetHospital,
      environments: this.envColumns(),
      envFlagsMap,
    };

    this.dialog.open(HospitalDetailsDialogComponent, {
      data: dialogData,
      width: '900px',
      maxWidth: '92vw',
      maxHeight: '88vh',
      panelClass: 'hospital-modal-panel',
      autoFocus: false,
    });
  }

  // Copy differences or whole table as CSV
  copyComparisonSummary() {
    const dcols = this.displayColumns();
    if (dcols.length === 0) return;

    const headers = dcols.map((d) => d.label).join(',');
    let csv = `Flag Name,Toggle Type,Description,Ticket,${headers}\n`;

    for (const row of this.filteredRows()) {
      const meta = row.metadata || {};
      const desc = (meta.description || '').replace(/"/g, '""');
      const ticket = meta.ticketId || '';
      const type = meta.toggleType || '';

      const states = dcols
        .map((d) => {
          const rawCell = row.envStates[d.envName];
          const effectiveState = this.getEffectiveState(rawCell, d.selectedHospitalId);
          if (effectiveState === 'PARTIALLY_ENABLED' && rawCell) {
            const hNames = (rawCell.hospitalIds || [])
              .map((id) => `${id}:${this.getHospitalName(id)}`)
              .join(';');
            return `PARTIAL(${hNames})`;
          }
          return effectiveState;
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
