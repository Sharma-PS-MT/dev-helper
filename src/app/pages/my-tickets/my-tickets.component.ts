import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatRadioModule } from '@angular/material/radio';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { JiraService } from '../../core/services/jira.service';
import { AuthConfigService } from '../../core/services/auth-config.service';
import { NotificationService } from '../../core/services/notification.service';
import { JiraIssueRaw } from '../../core/models/jira.models';
import { resolveStatusCategory } from '../../core/models/jira.models';

export interface WorkedTicketRow {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  worklogEntries: { date: string; timeSpent: string }[];
  loggedSeconds: number;          // personal worklogs in selected date range
  updated: string;
  url: string;
}

type QuickFilter = 'today' | 'last-week' | 'last-month' | 'custom';

@Component({
  selector: 'app-my-tickets',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, MatCardModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatTooltipModule, MatRadioModule,
    MatFormFieldModule, MatInputModule, MatTableModule, MatChipsModule,
    MatDatepickerModule, MatNativeDateModule,
  ],
  templateUrl: './my-tickets.component.html',
  styleUrls: ['./my-tickets.component.scss'],
})
export class MyTicketsComponent implements OnInit {
  // ── State ──────────────────────────────────────────────────────────────────
  loading     = signal(false);
  tickets     = signal<WorkedTicketRow[]>([]);
  errorMsg    = signal('');
  accountId   = signal('');
  displayName = signal('');

  quickFilter  = signal<QuickFilter>('today');
  customFrom: Date | string = '';
  customTo: Date | string   = '';

  columns = ['key', 'summary', 'status', 'worklogs', 'logged', 'updated'];

  // ── Computed ───────────────────────────────────────────────────────────────
  isConfigured = computed(() => {
    const c = this.authConfig.config();
    return !!(c.jiraBaseUrl && c.jiraEmail && c.jiraToken);
  });

  totalLogged = computed(() =>
    this.tickets().reduce((sum, t) => sum + t.loggedSeconds, 0)
  );

  withWorklogsCount = computed(() =>
    this.tickets().filter(t => t.loggedSeconds > 0).length
  );

  // ── Date helpers ───────────────────────────────────────────────────────────
  private toJqlDate(d: Date): string {
    return d.toISOString().slice(0, 10);   // YYYY-MM-DD
  }

  private getDateRange(): { from: string; to: string } {
    const now = new Date();
    const today = this.toJqlDate(now);

    const advance = (dateString: string) => {
       const d = new Date(dateString);
       d.setDate(d.getDate() + 1);
       return this.toJqlDate(d);
    };

    switch (this.quickFilter()) {
      case 'today':
        return { from: today, to: advance(today) };
      case 'last-week': {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return { from: this.toJqlDate(d), to: advance(today) };
      }
      case 'last-month': {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 1);
        return { from: this.toJqlDate(d), to: advance(today) };
      }
      case 'custom': {
        const f = this.customFrom instanceof Date ? this.toJqlDate(this.customFrom) : (this.customFrom as string);
        const rawT = this.customTo instanceof Date ? this.toJqlDate(this.customTo) : (this.customTo as string);
        return { from: f, to: advance(rawT) };
      }
    }
  }

  formatLogged(seconds: number): string {
    if (!seconds) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  constructor(
    private jira: JiraService,
    public authConfig: AuthConfigService,
    private notify: NotificationService,
  ) {}

  ngOnInit(): void {
    if (this.isConfigured()) {
      this.load();
    }
  }

  onQuickFilterChange(filter: QuickFilter) {
    this.quickFilter.set(filter);
    if (filter !== 'custom') {
      this.customFrom = null as any;
      this.customTo = null as any;
    }
    this.load();
  }

  onCustomDateChange() {
    if (this.customFrom && this.customTo) {
      this.quickFilter.set('custom');
      this.load();
    }
  }

  load(): void {
    if (!this.isConfigured()) return;

    const { from, to } = this.getDateRange();
    if (!from || !to) return;

    this.loading.set(true);
    this.tickets.set([]);
    this.errorMsg.set('');

    // Step 1: get accountId from /myself
    this.jira.getMyself().pipe(
      switchMap(me => {
        if (!me) throw new Error('Could not fetch Jira account info. Check your credentials.');
        this.accountId.set(me.accountId);
        this.displayName.set(me.displayName);

        const id = me.accountId;
        const dateClause = `updated >= "${from}" AND updated <= "${to}"`;

        // Step 2: run 5 JQL queries in parallel
        const queries = [
          `assignee = "${id}" AND ${dateClause} ORDER BY updated DESC`,
          `reporter = "${id}" AND ${dateClause} ORDER BY updated DESC`,
          `creator  = "${id}" AND ${dateClause} ORDER BY updated DESC`,
          `watcher  = "${id}" AND ${dateClause} ORDER BY updated DESC`,
          `"Developer[User Picker (single user)]" = "${id}" AND ${dateClause} ORDER BY updated DESC`,
        ];

        return forkJoin(
          queries.map(jql => this.jira.searchJql(jql, 100).pipe(catchError(() => of([]))))
        );
      }),
      switchMap((results: JiraIssueRaw[][]) => {
        // Deduplicate by key, preserve latest updated
        const map = new Map<string, JiraIssueRaw>();
        results.flat().forEach(issue => {
          const existing = map.get(issue.key);
          if (!existing || issue.fields.updated > existing.fields.updated) {
            map.set(issue.key, issue);
          }
        });
        const unique = Array.from(map.values())
          .sort((a, b) => b.fields.updated.localeCompare(a.fields.updated));

        if (unique.length === 0) return of([]);

        // Step 3: fetch worklogs for each unique issue in parallel
        const { from, to } = this.getDateRange();
        const fromMs = new Date(from).getTime();
        const toMs   = new Date(to).setHours(23, 59, 59, 999);
        const aid    = this.accountId();

        return forkJoin(
          unique.map(issue =>
            this.jira.getWorklogsForIssue(issue.key).pipe(
              catchError(() => of([])),
              switchMap(worklogs => {
                const validWorklogs = (worklogs as any[])
                  .filter(wl => {
                    const ts = new Date(wl.started).getTime();
                    const isWithinDate = ts >= fromMs && ts <= toMs;
                    if (!isWithinDate) return false;
                    const isMe = wl.author?.accountId === aid;
                    const isTempo = wl.author?.displayName === 'Timesheets by Tempo - Jira Time Tracking';
                    return isMe || isTempo;
                  });

                const personalSeconds = validWorklogs.reduce((s: number, wl: any) => s + (wl.timeSpentSeconds || 0), 0);
                
                const worklogEntries = validWorklogs.map(wl => ({
                  date: wl.started,
                  timeSpent: wl.timeSpent
                }));

                const sc = resolveStatusCategory({
                  id: issue.id, key: issue.key,
                  summary: issue.fields.summary,
                  status: issue.fields.status,
                  priority: issue.fields.priority,
                  issuetype: issue.fields.issuetype,
                  created: issue.fields.created,
                  updated: issue.fields.updated,
                });

                const row: WorkedTicketRow = {
                  key: issue.key,
                  summary: issue.fields.summary,
                  status: issue.fields.status?.name || '—',
                  statusCategory: sc,
                  worklogEntries: worklogEntries,
                  loggedSeconds: personalSeconds,
                  updated: issue.fields.updated,
                  url: this.jira.getTicketUrl(issue.key),
                };
                return of(row);
              })
            )
          )
        );
      }),
      catchError(err => {
        this.errorMsg.set(err.message || 'Failed to load tickets. Check your Jira configuration.');
        this.loading.set(false);
        return of([] as WorkedTicketRow[]);
      })
    ).subscribe(rows => {
      this.tickets.set(rows as WorkedTicketRow[]);
      this.loading.set(false);
    });
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
  }
}
