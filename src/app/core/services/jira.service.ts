import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AuthConfigService } from './auth-config.service';
import { JiraTicket, JiraIssueRaw, JiraSearchResult } from '../models/jira.models';

@Injectable({ providedIn: 'root' })
export class JiraService {
  constructor(
    private http: HttpClient,
    private authConfig: AuthConfigService,
  ) {}

  /** Build the common credentials payload sent to the Python proxy. */
  private get creds() {
    const c = this.authConfig.config();
    return {
      base_url: c.jiraBaseUrl,
      email: c.jiraEmail,
      token: c.jiraToken,
    };
  }

  private mapIssue(raw: JiraIssueRaw): JiraTicket {
    const c = this.authConfig.config();
    return {
      id: raw.id,
      key: raw.key,
      summary: raw.fields.summary,
      status: raw.fields.status,
      priority: raw.fields.priority,
      assignee: raw.fields.assignee || undefined,
      reporter: raw.fields.reporter || undefined,
      issuetype: raw.fields.issuetype,
      created: raw.fields.created,
      updated: raw.fields.updated,
      url: `${c.jiraBaseUrl}/browse/${raw.key}`,
    };
  }

  getIssue(key: string): Observable<JiraTicket | null> {
    return this.http
      .post<JiraIssueRaw>('/python-ai/jira/issue', { ...this.creds, key })
      .pipe(
        map(raw => this.mapIssue(raw)),
        catchError(() => of(null))
      );
  }

  getIssues(keys: string[]): Observable<JiraTicket[]> {
    if (!keys.length) return of([]);
    return this.http
      .post<{ issues: JiraIssueRaw[] }>('/python-ai/jira/issues/batch', {
        ...this.creds,
        keys,
        fields: 'summary,status,priority,assignee,reporter,issuetype,created,updated',
        max_results: 50,
      })
      .pipe(
        map(r => (r.issues || []).map(i => this.mapIssue(i))),
        catchError(() => of([] as JiraTicket[]))
      );
  }

  testConnection(): Observable<boolean> {
    return this.http
      .post('/python-ai/jira/myself', this.creds)
      .pipe(
        map(() => true),
        catchError(() => of(false))
      );
  }

  /** Fetch the current user's Jira profile (includes accountId). */
  getMyself(): Observable<{ accountId: string; displayName: string; emailAddress: string } | null> {
    return this.http
      .post<any>('/python-ai/jira/myself', this.creds)
      .pipe(
        map(res => ({ accountId: res.accountId, displayName: res.displayName, emailAddress: res.emailAddress })),
        catchError(() => of(null))
      );
  }

  /** Run an arbitrary JQL query and return raw issues (up to maxResults). */
  searchJql(jql: string, maxResults = 100): Observable<JiraIssueRaw[]> {
    return this.http
      .post<{ issues: JiraIssueRaw[] }>('/python-ai/jira/search', {
        ...this.creds,
        jql,
        max_results: maxResults,
        fields: 'summary,status,priority,assignee,reporter,issuetype,created,updated,timespent',
      })
      .pipe(
        map(r => r.issues || []),
        catchError(() => of([] as JiraIssueRaw[]))
      );
  }


  getTicketUrl(key: string): string {
    return `${this.authConfig.config().jiraBaseUrl}/browse/${key}`;
  }
}
