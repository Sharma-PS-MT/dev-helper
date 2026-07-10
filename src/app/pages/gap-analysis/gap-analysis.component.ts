import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { GapAnalysisEngineService, ServiceGapResult, GapEntry, GapStatus } from '../../core/services/gap-analysis-engine.service';
import { GapAnalysisStateService, GapServiceState } from '../../core/services/gap-analysis-state.service';
import { AuthConfigService } from '../../core/services/auth-config.service';
import { NotificationService } from '../../core/services/notification.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { VersionSelectDialogComponent } from './version-select-dialog.component';

interface GroupedCommitItem {
  message: string;
}

interface GroupedGapRow {
  ticketId: string;
  commits: GroupedCommitItem[];
  status: GapStatus;
  jiraStatus?: string;
  actionImpact: string;
  author?: string;
  ticketUrl?: string;
  isGrouped: true;
}

type DisplayGapRow = GapEntry | GroupedGapRow;

@Component({
  selector: 'app-gap-analysis',
  standalone: true,
  imports: [
    CommonModule, RouterModule, FormsModule,
    MatCardModule, MatButtonModule, MatIconModule,
    MatProgressBarModule, MatTableModule, MatChipsModule, MatTooltipModule,
    MatSlideToggleModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule
  ],
  templateUrl: './gap-analysis.component.html',
  styleUrls: ['./gap-analysis.component.scss']
})
export class GapAnalysisComponent implements OnInit {
  readonly gapStatusOptions: GapStatus[] = ['NEW_ADDED', 'REMOVED', 'DIFF_COMMIT', 'DIFF_MESSAGE'];
  readonly statusLabelMap: Record<GapStatus, string> = {
    NEW_ADDED: '✅ Added',
    REMOVED: '❌ Removed',
    DIFF_COMMIT: '🔗 Synced',
    DIFF_MESSAGE: '⚠️ Diverged'
  };
  readonly statusHintMap: Record<GapStatus, string> = {
    NEW_ADDED: 'New content introduced.',
    REMOVED: 'Content taken out.',
    DIFF_COMMIT: 'Code moved across branches with matching commit message.',
    DIFF_MESSAGE: 'Mismatch requiring review where both directions contain ticket-related commits.'
  };

  sourceEnv = '';
  targetEnv = '';
  selectedProjects: GapServiceState[] = [];
  versionColumns = ['appName', 'sourceVersion', 'targetVersion'];

  isProcessing = false;
  hasProcessed = false;

  results: ServiceGapResult[] = [];
  displayedColumns = ['ticketId', 'commitMessage', 'status', 'jiraStatus', 'actionImpact'];

  isGroupedByTicket = false;
  excludeMergeAndPR = true;
  filterTextSearch = '';
  filterGapStatuses: GapStatus[] = [];

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
      case 'REMOVED': return 'status-removing';
      case 'DIFF_COMMIT': return 'status-diff';
      case 'DIFF_MESSAGE': return 'status-diff-msg';
      default: return 'status-default';
    }
  }

  getStatusLabel(status: GapStatus): string {
    return this.statusLabelMap[status];
  }

  getStatusHint(status: GapStatus): string {
    return this.statusHintMap[status];
  }

  openServiceCompare(serviceName: string): void {
    const service = this.selectedProjects.find(project => project.appName === serviceName);
    if (!service) {
      this.notify.error(`Unable to locate compare details for ${serviceName}.`);
      return;
    }

    const baseUrl = this.authConfig.config().bitbucketBaseUrl?.trim().replace(/\/$/, '');
    if (!baseUrl || !service.project || !service.repository || !service.sourceVersion || !service.targetVersion) {
      this.notify.error(`Missing Bitbucket compare information for ${serviceName}.`);
      return;
    }

    const sourceRef = this.toBitbucketRef(service.sourceVersion);
    const targetRef = this.toBitbucketRef(service.targetVersion);
    const compareUrl = `${baseUrl}/projects/${encodeURIComponent(service.project)}/repos/${encodeURIComponent(service.repository)}/compare/commits?sourceBranch=${encodeURIComponent(sourceRef)}&targetBranch=${encodeURIComponent(targetRef)}`;
    window.open(compareUrl, '_blank', 'noopener');
  }

  getDisplayGaps(gaps: GapEntry[]): DisplayGapRow[] {
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
      return this.filterRows(filteredGaps);
    }

    // 3. Group by Ticket ID
    const map = new Map<string, {
      ticketId: string;
      commits: GroupedCommitItem[];
      forwardMessages: Set<string>;
      reverseMessages: Set<string>;
      jiraStatuses: Set<string>;
      actionImpacts: Set<string>;
      authors: Set<string>;
      ticketUrl: string;
      isGrouped: true;
    }>();

    for (const gap of filteredGaps) {
      const key = gap.ticketId || 'No Ticket';
      if (!map.has(key)) {
        map.set(key, {
          ticketId: key,
          commits: [],
          forwardMessages: new Set<string>(),
          reverseMessages: new Set<string>(),
          jiraStatuses: new Set<string>(),
          actionImpacts: new Set<string>(),
          authors: new Set<string>(),
          ticketUrl: '',
          isGrouped: true
        });
      }
      const grouped = map.get(key);
      if (!grouped) {
        continue;
      }

      grouped.commits.push({ message: gap.commitMessage });
      grouped.actionImpacts.add(gap.actionImpact);
      if (gap.jiraStatus) {
        gap.jiraStatus
          .split(',')
          .map(status => status.trim())
          .filter(status => status.length > 0 && status.toUpperCase() !== 'N/A')
          .forEach(status => grouped.jiraStatuses.add(status));
      }
      if (gap.author) {
        grouped.authors.add(gap.author);
      }
      if (!grouped.ticketUrl && gap.ticketUrl) {
        grouped.ticketUrl = gap.ticketUrl;
      }

      const normalizedMessage = gap.commitMessage.trim().toLowerCase();
      if (gap.status === 'NEW_ADDED') {
        grouped.forwardMessages.add(normalizedMessage);
      } else if (gap.status === 'REMOVED') {
        grouped.reverseMessages.add(normalizedMessage);
      } else {
        grouped.forwardMessages.add(normalizedMessage);
        grouped.reverseMessages.add(normalizedMessage);
      }
    }

    const groupedRows: GroupedGapRow[] = Array.from(map.values()).map(group => {
      const status = this.deriveGroupedStatus(group.forwardMessages, group.reverseMessages);
      return {
        ticketId: group.ticketId,
        commits: group.commits,
        status,
        jiraStatus: Array.from(group.jiraStatuses).join(', '),
        actionImpact: Array.from(group.actionImpacts).join(' | '),
        author: Array.from(group.authors).join(', '),
        ticketUrl: group.ticketUrl,
        isGrouped: true
      };
    });

    return this.filterRows(groupedRows);
  }

  private deriveGroupedStatus(forwardMessages: Set<string>, reverseMessages: Set<string>): GapStatus {
    if (forwardMessages.size > 0 && reverseMessages.size === 0) {
      return 'NEW_ADDED';
    }

    if (reverseMessages.size > 0 && forwardMessages.size === 0) {
      return 'REMOVED';
    }

    const hasSameMessage = Array.from(forwardMessages).some(message => reverseMessages.has(message));
    return hasSameMessage ? 'DIFF_COMMIT' : 'DIFF_MESSAGE';
  }

  private filterRows(rows: DisplayGapRow[]): DisplayGapRow[] {
    return rows.filter(row => {
      const statusMatch = this.filterGapStatuses.length === 0 || this.filterGapStatuses.includes(row.status);
      const searchText = [
        row.ticketId,
        this.getCommitTextForFilter(row),
        row.jiraStatus || '',
        row.actionImpact,
        row.author || '',
      ].join(' ');

      return (
        statusMatch &&
        this.containsText(searchText, this.filterTextSearch)
      );
    });
  }

  private getCommitTextForFilter(row: DisplayGapRow): string {
    if ('isGrouped' in row && row.isGrouped) {
      return row.commits.map(c => c.message).join(' ');
    }

    return row.commitMessage;
  }

  private containsText(value: string, filter: string): boolean {
    if (!filter.trim()) {
      return true;
    }

    return value.toLowerCase().includes(filter.trim().toLowerCase());
  }

  private toBitbucketRef(value: string): string {
    const trimmedValue = value.trim();
    if (trimmedValue.startsWith('refs/')) {
      return trimmedValue;
    }

    return `refs/tags/${trimmedValue}`;
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

      const gapHeaders = ['#', 'Ticket', 'Status', 'Jira Status', 'Author', 'Remark']
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
        const remark = gap.actionImpact;
        const jiraStatus = gap.jiraStatus || 'N/A';
        const author = gap.author || 'Unknown';
        return `
          <tr>
            <td style="${tdStyle}">${index + 1}</td>
            <td style="${tdStyle}">${ticketCell}</td>
            <td style="${tdStyle}">${this.getStatusLabel(gap.status)}</td>
            <td style="${tdStyle}">${jiraStatus}</td>
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
