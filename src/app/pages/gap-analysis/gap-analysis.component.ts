import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { GapAnalysisEngineService, ServiceGapResult, GapEntry } from '../../core/services/gap-analysis-engine.service';
import { GapAnalysisStateService, GapServiceState } from '../../core/services/gap-analysis-state.service';
import { AuthConfigService } from '../../core/services/auth-config.service';
import { NotificationService } from '../../core/services/notification.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { VersionSelectDialogComponent } from './version-select-dialog.component';

@Component({
  selector: 'app-gap-analysis',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTableModule, MatChipsModule, MatTooltipModule,
    MatSlideToggleModule, MatDialogModule
  ],
  templateUrl: './gap-analysis.component.html',
  styleUrls: ['./gap-analysis.component.scss']
})
export class GapAnalysisComponent implements OnInit {
  sourceEnv = '';
  targetEnv = '';
  selectedProjects: GapServiceState[] = [];
  versionColumns = ['appName', 'sourceVersion', 'targetVersion'];

  isProcessing = false;
  hasProcessed = false;

  results: ServiceGapResult[] = [];
  displayedColumns = ['ticketId', 'commitMessage', 'direction', 'status', 'actionImpact'];

  isGroupedByTicket = false;
  excludeMergeAndPR = true;

  private static readonly MERGE_PATTERNS = [
    /^merge branch /i,
    /^merge remote-tracking branch /i,
    /^merge tag /i,
    /^merged .+ into /i,
    /^revert "?merge /i,
    /^auto-merge /i,
  ];

  private static readonly PR_PATTERNS = [
    /^merge pull request /i,
    /^merge pull request #/i,
    /^merged in /i,
    /^pull request #\d+:/i,
    /^merged (pull|remote)/i,
  ];

  constructor(
    private router: Router,
    private gapEngine: GapAnalysisEngineService,
    private gapState: GapAnalysisStateService,
    private authConfig: AuthConfigService,
    private notify: NotificationService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    const state = this.gapState.consume();
    if (state) {
      this.sourceEnv = state.sourceEnv;
      this.targetEnv = state.targetEnv;
      this.selectedProjects = state.services;
    } else {
      // If no state, go back
      this.router.navigate(['/argocd-dashboard']);
    }
  }

  swapDirection() {
    const temp = this.sourceEnv;
    this.sourceEnv = this.targetEnv;
    this.targetEnv = temp;
    
    // Swap versions in the state
    this.selectedProjects = this.selectedProjects.map(p => ({
      appName: p.appName,
      repository: p.repository,
      project: p.project,
      sourceVersion: p.targetVersion,
      targetVersion: p.sourceVersion
    }));

    // If already processed, reset results so user must process again for new direction
    if (this.hasProcessed) {
      this.hasProcessed = false;
      this.results = [];
    }
  }

  processGaps() {
    this.isProcessing = true;
    this.hasProcessed = false;
    this.results = [];

    // Use the explicitly selected projects state
    const services = this.selectedProjects;

    this.gapEngine.processGaps(this.sourceEnv, this.targetEnv, services).subscribe({
      next: (data) => {
        this.results = data;
        this.isProcessing = false;
        this.hasProcessed = true;
      },
      error: (err) => {
        console.error('Gap analysis failed', err);
        this.isProcessing = false;
      }
    });
  }

  openVersionDialog(p: GapServiceState, field: 'sourceVersion' | 'targetVersion') {
    const dialogRef = this.dialog.open(VersionSelectDialogComponent, {
      width: '500px',
      data: {
        appName: p.appName,
        repository: p.repository,
        project: p.project,
        currentVersion: p[field]
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result !== p[field]) {
        p[field] = result;
        if (this.hasProcessed) {
          this.processGaps();
        }
      }
    });
  }

  getStatusClass(status: string): string {
    switch(status) {
      case 'NEW_ADDED': return 'status-new';
      case 'REMOVING': return 'status-removing';
      case 'DIFF_COMMIT': return 'status-diff';
      case 'DIFF_COMMIT_MESSAGE': return 'status-diff-msg';
      default: return 'status-default';
    }
  }

  getDisplayGaps(gaps: GapEntry[]): any[] {
    // 1. Filter out Merge and PR commits if the toggle is ON
    let filteredGaps = gaps;
    if (this.excludeMergeAndPR) {
      filteredGaps = gaps.filter(gap => {
        const msg = gap.commitMessage.trim();
        const isMerge = GapAnalysisComponent.MERGE_PATTERNS.some(p => p.test(msg));
        const isPR = GapAnalysisComponent.PR_PATTERNS.some(p => p.test(msg));
        return !isMerge && !isPR;
      });
    }

    // 2. Return flat list if grouping is OFF
    if (!this.isGroupedByTicket) {
      return filteredGaps;
    }

    // 3. Group by Ticket ID
    const map = new Map<string, any>();
    for (const gap of filteredGaps) {
      const key = gap.ticketId || 'No Ticket';
      if (!map.has(key)) {
        map.set(key, {
          ticketId: gap.ticketId,
          commits: [],
          direction: gap.direction,
          status: gap.status,
          actionImpact: gap.actionImpact,
          author: gap.author,
          jiraStatus: gap.jiraStatus,
          ticketUrl: gap.ticketUrl,
          isGrouped: true
        });
      }
      map.get(key).commits.push({ sha: gap.commitSha, message: gap.commitMessage });
    }
    return Array.from(map.values());
  }

  copyToConfluence() {
    if (!this.results || this.results.length === 0) {
      this.notify.error('No results to copy.');
      return;
    }

    const jiraBase = (this.authConfig.config().jiraBaseUrl || '').replace(/\/$/, '');
    const thStyle = 'border:1px solid #ccc;padding:6px 10px;background:#f4f5f7;font-weight:600;text-align:left;';
    const tdStyle = 'border:1px solid #ccc;padding:6px 10px;vertical-align:top;';

    // 1. Services and Versions Table
    const summaryHeaders = ['Application', `${this.sourceEnv} Version`, `${this.targetEnv} Version`]
      .map(h => `<th style="${thStyle}">${h}</th>`).join('');
    
    const summaryRows = this.selectedProjects.map(p => `
      <tr>
        <td style="${tdStyle}">${p.appName}</td>
        <td style="${tdStyle}">${p.sourceVersion}</td>
        <td style="${tdStyle}">${p.targetVersion}</td>
      </tr>
    `).join('');

    let html = `
      <h3>Services and Versions</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;margin-bottom:24px;">
        <thead><tr>${summaryHeaders}</tr></thead>
        <tbody>${summaryRows}</tbody>
      </table>
    `;

    // 2. Per-Service Tables
    for (const result of this.results) {
      const displayGaps = this.getDisplayGaps(result.gaps);
      if (displayGaps.length === 0) continue;

      const gapHeaders = ['#', 'Ticket', 'Status', 'Author', 'Remark']
        .map(h => `<th style="${thStyle}">${h}</th>`).join('');

      const gapRows = displayGaps.map((gap, index) => {
        const ticketKey = gap.ticketId || 'No Ticket';
        let resolvedUrl = gap.ticketUrl;
        if (!resolvedUrl && jiraBase && ticketKey !== 'No Ticket' && ticketKey !== 'ERROR') {
          // If multiple tickets, just link the first one or just link the text
          const firstKey = ticketKey.split(',')[0].trim();
          resolvedUrl = `${jiraBase}/browse/${firstKey}`;
        }

        const ticketCell = resolvedUrl && ticketKey !== 'No Ticket'
          ? `<a href="${resolvedUrl}" target="_blank" rel="noopener">${resolvedUrl}</a>`
          : ticketKey;

        // Map status to UI text (using actionImpact or status)
        // The user requested Status in the format: Gap-Status (e.g. NEW_ADDED)
        const remark = gap.status;
        const author = gap.author || 'Unknown';
        const jStatus = gap.jiraStatus || 'N/A';

        return `
          <tr>
            <td style="${tdStyle}">${index + 1}</td>
            <td style="${tdStyle}">${ticketCell}</td>
            <td style="${tdStyle}">${jStatus}</td>
            <td style="${tdStyle}">${author}</td>
            <td style="${tdStyle}">${remark}</td>
          </tr>
        `;
      }).join('');

      html += `
        <h4>${result.serviceName}</h4>
        <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;margin-bottom:24px;">
          <thead><tr>${gapHeaders}</tr></thead>
          <tbody>${gapRows}</tbody>
        </table>
      `;
    }

    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob(['Please paste into a rich-text editor (like Confluence) to see the tables.'], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(() => {
        this.notify.success('Copied GAP Analysis to clipboard! Ready to paste into Confluence.');
      }).catch(err => {
        console.error('Clipboard write error', err);
        this.notify.error('Failed to copy to clipboard.');
      });
    } catch (e) {
      this.notify.error('Clipboard API not supported in this browser.');
    }
  }
}
