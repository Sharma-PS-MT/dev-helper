import {
  Component,
  Inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { FeatureFlag, Hospital } from '../../core/services/feature-toggle.service';

export interface HospitalDialogData {
  hospital: Hospital;
  environments: string[];
  envFlagsMap: { [envName: string]: FeatureFlag[] };
}

export type HospitalFlagStatus = 'ENABLED_GLOBAL' | 'ENABLED_TARGETED' | 'DISABLED' | 'NOT_FOUND';

export interface HospitalFlagRow {
  flagName: string;
  ticketId?: string;
  toggleType?: string;
  description?: string;
  releaseVersion?: string;
  envStatuses: {
    [envName: string]: {
      status: HospitalFlagStatus;
      isTargeted: boolean;
      allTargetedCount?: number;
    };
  };
  isAnyEnabled: boolean;
  isAnyTargeted: boolean;
}

@Component({
  selector: 'app-hospital-details-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
    MatChipsModule,
  ],
  templateUrl: './hospital-details-dialog.component.html',
  styleUrls: ['./hospital-details-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HospitalDetailsDialogComponent {
  hospital: Hospital;
  environments: string[];
  envFlagsMap: { [envName: string]: FeatureFlag[] };

  searchTerm = signal<string>('');
  filterType = signal<'all' | 'enabled' | 'targeted' | 'disabled'>('all');

  allFlagRows = computed<HospitalFlagRow[]>(() => {
    const hid = this.hospital.id;
    const envs = this.environments;
    const flagsMap = this.envFlagsMap;

    const allFlags = new Map<string, FeatureFlag>();
    for (const env of envs) {
      const list = flagsMap[env] || [];
      for (const f of list) {
        if (!allFlags.has(f.flag)) {
          allFlags.set(f.flag, f);
        } else if (!allFlags.get(f.flag)?.metadata && f.metadata) {
          allFlags.set(f.flag, f);
        }
      }
    }

    const rows: HospitalFlagRow[] = [];

    allFlags.forEach((sampleFlag, flagName) => {
      const envStatuses: HospitalFlagRow['envStatuses'] = {};
      let isAnyEnabled = false;
      let isAnyTargeted = false;

      for (const env of envs) {
        const envList = flagsMap[env] || [];
        const found = envList.find((f) => f.flag === flagName);

        if (!found) {
          envStatuses[env] = { status: 'NOT_FOUND', isTargeted: false };
          continue;
        }

        const stateUpper = (found.state || '').toUpperCase();
        const hospitalIds = found.target?.hospitalIds || [];
        const hasHospitalTargeting = hospitalIds.length > 0;

        if (hasHospitalTargeting) {
          const isTargetedToThisHospital = hospitalIds.some(
            (id: any) => String(id).trim() === String(hid).trim(),
          );
          if (isTargetedToThisHospital) {
            envStatuses[env] = {
              status: 'ENABLED_TARGETED',
              isTargeted: true,
              allTargetedCount: hospitalIds.length,
            };
            isAnyEnabled = true;
            isAnyTargeted = true;
          } else {
            envStatuses[env] = {
              status: 'DISABLED',
              isTargeted: false,
              allTargetedCount: hospitalIds.length,
            };
          }
        } else if (stateUpper === 'ENABLED' && found.target?.status !== false) {
          envStatuses[env] = { status: 'ENABLED_GLOBAL', isTargeted: false };
          isAnyEnabled = true;
        } else {
          envStatuses[env] = { status: 'DISABLED', isTargeted: false };
        }
      }

      rows.push({
        flagName,
        ticketId: sampleFlag.metadata?.ticketId,
        toggleType: sampleFlag.metadata?.toggleType,
        description: sampleFlag.metadata?.description,
        releaseVersion: sampleFlag.metadata?.releaseVersion,
        envStatuses,
        isAnyEnabled,
        isAnyTargeted,
      });
    });

    return rows.sort((a, b) => a.flagName.localeCompare(b.flagName));
  });

  filteredFlagRows = computed<HospitalFlagRow[]>(() => {
    const search = this.searchTerm().trim().toLowerCase();
    const type = this.filterType();

    return this.allFlagRows().filter((row) => {
      if (search) {
        const matchName = row.flagName.toLowerCase().includes(search);
        const matchDesc = row.description?.toLowerCase().includes(search) || false;
        const matchTicket = row.ticketId?.toLowerCase().includes(search) || false;
        if (!matchName && !matchDesc && !matchTicket) return false;
      }

      if (type === 'enabled') {
        return row.isAnyEnabled;
      }
      if (type === 'targeted') {
        return row.isAnyTargeted;
      }
      if (type === 'disabled') {
        return !row.isAnyEnabled;
      }

      return true;
    });
  });

  totalFlags = computed(() => this.allFlagRows().length);
  enabledCount = computed(() => this.allFlagRows().filter((r) => r.isAnyEnabled).length);
  targetedCount = computed(() => this.allFlagRows().filter((r) => r.isAnyTargeted).length);

  constructor(
    public dialogRef: MatDialogRef<HospitalDetailsDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: HospitalDialogData,
  ) {
    this.hospital = data.hospital;
    this.environments = data.environments;
    this.envFlagsMap = data.envFlagsMap;
  }

  getStatusTooltip(status: HospitalFlagStatus, count?: number): string {
    switch (status) {
      case 'ENABLED_GLOBAL':
        return 'Globally active for all hospitals in this environment';
      case 'ENABLED_TARGETED':
        return `Active for this hospital (Targeted among ${count || 1} hospitals)`;
      case 'DISABLED':
        return count && count > 0
          ? `Excluded: This hospital is not in the targeted list (${count} others targeted)`
          : 'Disabled in this environment';
      case 'NOT_FOUND':
        return 'Feature flag not configured in this environment';
    }
  }
}
