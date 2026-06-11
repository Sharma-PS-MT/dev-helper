import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { AuthConfigService } from './auth-config.service';
import {
  BitbucketProject, BitbucketRepo, BitbucketBranch, BitbucketTag,
  BitbucketCommit, BitbucketPR, PRAnalysis, PRGap, CommitWithTickets, BranchComparison, TicketSummary, BranchGapAnalysis
} from '../models/bitbucket.models';
import { JiraService } from './jira.service';
import { JiraTicket, resolveStatusCategory } from '../models/jira.models';

interface PagedResponse<T> { values: T[]; limit: number; isLastPage?: boolean; nextPageStart?: number; }

@Injectable({ providedIn: 'root' })
export class BitbucketService {
  constructor(
    private http: HttpClient,
    private authConfig: AuthConfigService,
    private jira: JiraService,
  ) {}

  /** Build the common credentials payload sent to the Python proxy. */
  private get creds() {
    const c = this.authConfig.config();
    return {
      base_url: c.bitbucketBaseUrl,
      token: c.bitbucketToken,
    };
  }

  private get ws(): string { return this.authConfig.config().bitbucketWorkspace; }

  // ── Projects ────────────────────────────────────────────────────────────────
  getProjects(): Observable<BitbucketProject[]> {
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/projects', this.creds)
      .pipe(
        map(r => r.values.map(p => ({
          key: p.key,
          name: p.name,
          type: 'project',
          description: p.description
        })))
      );
  }

  // ── Repositories ────────────────────────────────────────────────────────────
  getRepositories(projectKey?: string): Observable<BitbucketRepo[]> {
    const pk = projectKey || this.ws;
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/repos', { ...this.creds, project_key: pk })
      .pipe(map(r => r.values.map(repo => ({
        slug: repo.slug,
        name: repo.name,
        full_name: `${repo.project?.key || pk}/${repo.slug}`,
        description: repo.description
      }))));
  }

  // ── Branches ─────────────────────────────────────────────────────────────────
  getBranches(repoSlug: string, projectKey?: string, filterText?: string, start?: number, limit: number = 20): Observable<PagedResponse<BitbucketBranch>> {
    const pk = projectKey || this.ws;
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/branches', {
        ...this.creds,
        project_key: pk,
        repo_slug: repoSlug,
        ...(filterText ? { filter_text: filterText } : {}),
        ...(start !== undefined ? { start } : {}),
        limit,
      })
      .pipe(map(r => ({
        ...r,
        values: r.values.map((b: any) => ({
          name: b.displayId,
          target: { hash: b.latestCommit, date: '' }
        }))
      })));
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────
  getTags(repoSlug: string, projectKey?: string, filterText?: string, start?: number, limit: number = 20): Observable<PagedResponse<BitbucketTag>> {
    const pk = projectKey || this.ws;
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/tags', {
        ...this.creds,
        project_key: pk,
        repo_slug: repoSlug,
        ...(filterText ? { filter_text: filterText } : {}),
        ...(start !== undefined ? { start } : {}),
        limit,
      })
      .pipe(map(r => ({
        ...r,
        values: r.values.map((t: any) => ({
          name: t.displayId,
          target: { hash: t.latestCommit, date: '' }
        }))
      })));
  }

  // ── Pull Request ──────────────────────────────────────────────────────────────
  private mapPR(pr: any): BitbucketPR {
    return {
      id: pr.id,
      title: pr.title,
      description: pr.description,
      state: pr.state,
      author: { display_name: pr.author?.user?.displayName || '', uuid: pr.author?.user?.name || '' },
      created_on: new Date(pr.createdDate).toISOString(),
      updated_on: new Date(pr.updatedDate).toISOString(),
      source: { branch: { name: pr.fromRef?.displayId || '' }, repository: { full_name: `${pr.fromRef?.repository?.project?.key}/${pr.fromRef?.repository?.slug}` } },
      destination: { branch: { name: pr.toRef?.displayId || '' } },
      reviewers: (pr.reviewers || []).map((r: any) => ({ display_name: r.user?.displayName, role: r.role })),
      participants: (pr.participants || []).map((p: any) => ({ display_name: p.user?.displayName, approved: p.approved, role: p.role })),
      comment_count: 0,
      task_count: 0,
      links: { html: { href: pr.links?.self?.[0]?.href || '' } }
    };
  }

  getPullRequest(repoSlug: string, prId: number, projectKey?: string): Observable<BitbucketPR> {
    const pk = projectKey || this.ws;
    return this.http
      .post<any>('/python-ai/bitbucket/pull-request', {
        ...this.creds,
        project_key: pk,
        repo_slug: repoSlug,
        pr_id: prId,
      })
      .pipe(map(pr => this.mapPR(pr)));
  }

  private mapCommit(c: any): BitbucketCommit {
    return {
      hash: c.id,
      message: c.message,
      author: { raw: c.author?.displayName || '', user: { display_name: c.author?.displayName || '' } },
      date: new Date(c.authorTimestamp || Date.now()).toISOString(),
      parents: (c.parents || []).map((p: any) => ({ hash: p.id })),
      ticketIds: c.properties?.['jira-key'] || []
    };
  }

  getPRCommits(repoSlug: string, prId: number, projectKey?: string): Observable<BitbucketCommit[]> {
    const pk = projectKey || this.ws;
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/pull-request/commits', {
        ...this.creds,
        project_key: pk,
        repo_slug: repoSlug,
        pr_id: prId,
      })
      .pipe(map(r => r.values.map(c => this.mapCommit(c))));
  }

  parsePRUrl(url: string): { projectKey: string; repoSlug: string; prId: number } | null {
    const m = url.match(/\/projects\/([^/]+)\/repos\/([^/]+)\/pull-requests?\/(\d+)/i);
    if (m) return { projectKey: m[1], repoSlug: m[2], prId: +m[3] };
    const num = url.match(/^(\d+)$/);
    if (num) return null;
    return null;
  }

  getOpenPullRequests(repoSlug: string, projectKey?: string): Observable<BitbucketPR[]> {
    const pk = projectKey || this.ws;
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/pull-requests/open', {
        ...this.creds,
        project_key: pk,
        repo_slug: repoSlug,
      })
      .pipe(map(r => r.values.map(pr => this.mapPR(pr))));
  }

  // ── PR Analysis ──────────────────────────────────────────────────────────────
  analyzePR(repoSlug: string, prId: number, projectKey?: string): Observable<PRAnalysis> {
    return forkJoin({
      pr: this.getPullRequest(repoSlug, prId, projectKey),
      commits: this.getPRCommits(repoSlug, prId, projectKey),
    }).pipe(
      switchMap(({ pr, commits }) => {
        const allMessages = commits.map(c => c.message).join('\n');
        const descText = pr.description || '';
        const regexIds = this.authConfig.extractTicketIds(allMessages);
        const propIds = commits.flatMap(c => c.ticketIds || []);
        const ticketIds = [...new Set([...regexIds, ...propIds])];

        const descTickets = this.authConfig.extractTicketIds(descText);

        if (ticketIds.length === 0) {
          return of({ pr, commits, ticketIds, missingTicketCommits: commits, gaps: this.buildGaps(pr, commits, ticketIds, [], descTickets), tickets: [] });
        }

        return this.jira.getIssues(ticketIds).pipe(
          map(tickets => {
            const missingTicketCommits = commits.filter(c => {
               const ids = [...new Set([...this.authConfig.extractTicketIds(c.message), ...(c.ticketIds || [])])];
               return ids.length === 0;
            });
            const gaps = this.buildGaps(pr, commits, ticketIds, tickets, descTickets);
            return { pr, commits, ticketIds, missingTicketCommits, gaps, tickets };
          })
        );
      }),
      map((data: any) => ({
        pr: data.pr,
        commits: data.commits,
        ticketIds: data.ticketIds,
        missingTicketCommits: data.missingTicketCommits,
        gaps: data.gaps,
        tickets: data.tickets || [],
      }))
    );
  }

  private buildGaps(pr: BitbucketPR, commits: BitbucketCommit[], ticketIds: string[], tickets: JiraTicket[], descTickets: string[]): PRGap[] {
    const gaps: PRGap[] = [];

    // Commits without ticket IDs
    const noTicketCommits = commits.filter(c => this.authConfig.extractTicketIds(c.message).length === 0);
    if (noTicketCommits.length > 0) {
      gaps.push({
        type: 'missing-ticket', severity: 'warn',
        message: `${noTicketCommits.length} commit(s) have no JIRA ticket ID`,
        detail: noTicketCommits.map(c => c.message.split('\n')[0]).join('; '),
      });
    }

    // Tickets not in Done state
    const openTickets = tickets.filter(t => resolveStatusCategory(t) !== 'done');
    for (const t of openTickets) {
      gaps.push({
        type: 'open-ticket', severity: resolveStatusCategory(t) === 'blocked' ? 'error' : 'warn',
        message: `Ticket ${t.key} is not Done (${t.status.name})`,
        detail: t.summary, ticketId: t.key,
      });
    }

    // Tickets in commits not mentioned in PR description
    const notLinked = ticketIds.filter(id => !descTickets.includes(id));
    if (notLinked.length > 0) {
      gaps.push({
        type: 'not-linked', severity: 'info',
        message: `${notLinked.length} ticket(s) in commits not mentioned in PR description`,
        detail: notLinked.join(', '),
      });
    }

    // PR still open
    if (pr.state === 'OPEN') {
      gaps.push({ type: 'pr-open', severity: 'info', message: 'PR is still OPEN and not yet merged' });
    }

    // No reviewers approved
    const approved = (pr.participants || []).filter(p => p.approved);
    if (approved.length === 0 && pr.reviewers?.length === 0) {
      gaps.push({ type: 'no-reviewers', severity: 'warn', message: 'No reviewers assigned to this PR' });
    }

    return gaps;
  }

  // ── Branch/Tag Comparison ────────────────────────────────────────────────────
  getCommitsBetween(repoSlug: string, from: string, to: string, projectKey?: string): Observable<BitbucketCommit[]> {
    const pk = projectKey || this.ws;
    return this.http
      .post<PagedResponse<any>>('/python-ai/bitbucket/commits-between', {
        ...this.creds,
        project_key: pk,
        repo_slug: repoSlug,
        from_ref: from,
        to_ref: to,
        limit: 1000,
      })
      .pipe(map(r => r.values.map(c => this.mapCommit(c))));
  }

  // ── Gap Analysis ─────────────────────────────────────────────────────────────
  analyzeGap(repoSlug: string, fromRef: string, toRef: string, projectKey?: string): Observable<BranchGapAnalysis> {
    return forkJoin({
      forward: this.getCommitsBetween(repoSlug, fromRef, toRef, projectKey),
      reverse: this.getCommitsBetween(repoSlug, toRef, fromRef, projectKey),
    }).pipe(
      switchMap(({ forward, reverse }) => {
        // Build message frequency maps
        const countMap = (commits: BitbucketCommit[]) => {
          const map = new Map<string, number>();
          for (const c of commits) {
            const key = c.message.trim().split('\n')[0]; // first line only
            map.set(key, (map.get(key) || 0) + 1);
          }
          return map;
        };

        const forwardCounts = countMap(forward);
        const reverseCounts = countMap(reverse);

        // Deduplicate: subtract reverse counts from forward counts (net per message key)
        const deduplicate = (commits: BitbucketCommit[], otherCounts: Map<string, number>): BitbucketCommit[] => {
          const remaining = new Map<string, number>(otherCounts);
          return commits.filter(c => {
            const key = c.message.trim().split('\n')[0];
            const available = remaining.get(key) || 0;
            if (available > 0) {
              remaining.set(key, available - 1);
              return false; // absorbed by other side
            }
            return true;
          });
        };

        // forward = commits in toRef NOT in fromRef  (since=fromRef, until=toRef)
        // reverse = commits in fromRef NOT in toRef  (since=toRef, until=fromRef)
        // Critical = fromRef unique (what fromRef has that toRef doesn't) → reverse
        // Incoming = toRef unique (what toRef has that fromRef doesn't) → forward
        const criticalCommits = deduplicate(reverse, new Map(forwardCounts));
        const incomingCommits = deduplicate(forward, new Map(reverseCounts));

        // Collect all unique ticket IDs from both sets
        const allCommits = [...criticalCommits, ...incomingCommits];
        const allText = allCommits.map(c => c.message).join('\n');
        const regexIds = this.authConfig.extractTicketIds(allText);
        const propIds = allCommits.flatMap(c => c.ticketIds || []);
        const ticketIds = [...new Set([...regexIds, ...propIds])];

        const enrichCommits = (commits: BitbucketCommit[], tickets: Map<string, JiraTicket>): CommitWithTickets[] =>
          commits.map(c => {
            const ids = [...new Set([...this.authConfig.extractTicketIds(c.message), ...(c.ticketIds || [])])];
            return { commit: c, ticketIds: ids, tickets: ids.map(id => tickets.get(id)).filter(Boolean) as JiraTicket[] };
          });

        if (ticketIds.length === 0) {
          return of<BranchGapAnalysis>({
            fromRef, toRef,
            criticalCommits: criticalCommits.map(c => ({ commit: c, ticketIds: [], tickets: [] })),
            incomingCommits: incomingCommits.map(c => ({ commit: c, ticketIds: [], tickets: [] })),
            totalForward: forward.length,
            totalReverse: reverse.length,
          });
        }

        return this.jira.getIssues(ticketIds).pipe(
          map(tickets => {
            const ticketMap = new Map(tickets.map(t => [t.key, t]));
            return {
              fromRef, toRef,
              criticalCommits: enrichCommits(criticalCommits, ticketMap),
              incomingCommits: enrichCommits(incomingCommits, ticketMap),
              totalForward: forward.length,
              totalReverse: reverse.length,
            } as BranchGapAnalysis;
          })
        );
      })
    );
  }

  compareBranchesOrTags(repoSlug: string, from: string, to: string, projectKey?: string): Observable<BranchComparison> {
    return this.getCommitsBetween(repoSlug, from, to, projectKey).pipe(
      switchMap(commits => {
        const allText = commits.map(c => c.message).join('\n');
        const regexIds = this.authConfig.extractTicketIds(allText);
        const propIds = commits.flatMap(c => c.ticketIds || []);
        const ticketIds = [...new Set([...regexIds, ...propIds])];

        if (ticketIds.length === 0) {
          const cwt: CommitWithTickets[] = commits.map(c => ({ commit: c, ticketIds: [], tickets: [] }));
          return of({ fromRef: from, toRef: to, commits: cwt, ticketSummary: this.buildSummary([]) });
        }

        return this.jira.getIssues(ticketIds).pipe(
          map(tickets => {
            const ticketMap = new Map(tickets.map(t => [t.key, t]));
            const cwt: CommitWithTickets[] = commits.map(c => {
              const ids = [...new Set([...this.authConfig.extractTicketIds(c.message), ...(c.ticketIds || [])])];
              return { commit: c, ticketIds: ids, tickets: ids.map(id => ticketMap.get(id)).filter(Boolean) as JiraTicket[] };
            });
            return { fromRef: from, toRef: to, commits: cwt, ticketSummary: this.buildSummary(tickets) };
          })
        );
      })
    );
  }

  private buildSummary(tickets: JiraTicket[]): TicketSummary {
    const summary: TicketSummary = { total: tickets.length, done: 0, inProgress: 0, todo: 0, blocked: 0, other: 0 };
    for (const t of tickets) {
      const cat = resolveStatusCategory(t);
      if (cat === 'done') summary.done++;
      else if (cat === 'progress') summary.inProgress++;
      else if (cat === 'todo') summary.todo++;
      else if (cat === 'blocked') summary.blocked++;
      else summary.other++;
    }
    return summary;
  }
}
