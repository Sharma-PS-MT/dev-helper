import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ArgoAppModel } from '../../core/services/argocd.service';

interface CompareData {
  appA: ArgoAppModel;
  appB: ArgoAppModel;
}

interface CompareRow {
  label: string;
  valA: string;
  valB: string;
  different: boolean;
}

@Component({
  selector: 'app-argocd-compare-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="compare-dialog">
      <div class="compare-header">
        <h2><mat-icon>compare</mat-icon> Application Comparison</h2>
        <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
      </div>

      <div class="compare-body">
        <!-- App name headers -->
        <div class="compare-grid header-row">
          <div class="field-label"></div>
          <div class="val-header">{{ data.appA.name }}</div>
          <div class="val-header">{{ data.appB.name }}</div>
        </div>

        <!-- Diff rows -->
        <div class="compare-grid data-row"
             *ngFor="let row of rows"
             [class.diff]="row.different">
          <div class="field-label">{{ row.label }}</div>
          <div class="field-val" [class.changed]="row.different">
            <mat-icon *ngIf="row.different" class="diff-icon" inline>circle</mat-icon>
            {{ row.valA || '—' }}
          </div>
          <div class="field-val" [class.changed]="row.different">
            <mat-icon *ngIf="row.different" class="diff-icon" inline>circle</mat-icon>
            {{ row.valB || '—' }}
          </div>
        </div>
      </div>

      <div class="compare-footer">
        <span class="diff-count">
          <mat-icon inline>swap_horiz</mat-icon>
          {{ diffCount }} difference(s) found
        </span>
        <button mat-flat-button color="primary" (click)="close()">Close</button>
      </div>
    </div>
  `,
  styles: [`
    .compare-dialog {
      background: var(--bg-secondary);
      color: var(--text-primary);
      min-width: 760px;
    }
    .compare-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px 12px;
      border-bottom: 1px solid var(--border-color);
      h2 { margin: 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
      mat-icon { color: var(--accent-cyan); }
    }
    .compare-body {
      padding: 16px 24px;
      max-height: calc(80vh - 120px);
      overflow-y: auto;
    }
    .compare-grid {
      display: grid;
      grid-template-columns: 160px 1fr 1fr;
      gap: 8px;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--border-subtle);
    }
    .header-row {
      margin-bottom: 4px;
      border-bottom: 2px solid var(--border-color);
    }
    .val-header {
      font-weight: 700; font-size: 14px; color: var(--text-primary);
      padding: 4px 8px;
      background: var(--bg-elevated);
      border-radius: 6px;
      text-align: center;
    }
    .field-label {
      font-size: 12px; font-weight: 600; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .field-val {
      font-size: 13px; color: var(--text-secondary);
      padding: 4px 8px; border-radius: 4px;
      word-break: break-all;
      display: flex; align-items: center; gap: 4px;
    }
    .data-row.diff {
      background: rgba(255, 152, 0, 0.06);
      border-radius: 6px;
      .field-label { color: #FF9800; }
    }
    .field-val.changed {
      color: #FF9800;
      font-weight: 600;
      background: rgba(255, 152, 0, 0.08);
      .diff-icon { font-size: 8px; width: 8px; height: 8px; color: #FF9800; }
    }
    .compare-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 24px 20px;
      border-top: 1px solid var(--border-color);
      .diff-count { font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px; }
    }
  `]
})
export class ArgocdCompareDialogComponent {
  rows: CompareRow[];
  diffCount: number;

  constructor(
    public dialogRef: MatDialogRef<ArgocdCompareDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CompareData
  ) {
    const fields: { label: string; key: keyof ArgoAppModel }[] = [
      { label: 'Environment',    key: 'envName' },
      { label: 'Namespace',      key: 'namespace' },
      { label: 'Sync Status',    key: 'syncStatus' },
      { label: 'Health Status',  key: 'healthStatus' },
      { label: 'Sync Tag',       key: 'syncTag' },
      { label: 'Last Synced At', key: 'lastSyncedAt' },
    ];

    this.rows = fields.map(f => {
      const valA = String(data.appA[f.key] ?? '');
      const valB = String(data.appB[f.key] ?? '');
      return { label: f.label, valA, valB, different: valA !== valB };
    });

    this.diffCount = this.rows.filter(r => r.different).length;
  }

  close() { this.dialogRef.close(); }
}
