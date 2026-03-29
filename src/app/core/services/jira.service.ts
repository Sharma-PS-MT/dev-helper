import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
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

  private get base(): string { return this.authConfig.config().jiraBaseUrl; }

  private get headers() {
    return {
      Authorization: this.authConfig.jiraAuthHeader,
      Accept: 'application/json'
    };
  }

  private mapIssue(raw: JiraIssueRaw): JiraTicket {
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
      url: `${this.base}/browse/${raw.key}`,
    };
  }

  getIssue(key: string): Observable<JiraTicket | null> {
    return this.http
      .get<JiraIssueRaw>(`${this.base}/rest/api/2/issue/${key}`, { headers: this.headers })
      .pipe(
        map(raw => this.mapIssue(raw)),
        catchError(() => of(null))
      );
  }

  getIssues(keys: string[]): Observable<JiraTicket[]> {
    if (!keys.length) return of([]);
    // Batch via JQL (up to 100)
    const batches: string[][] = [];
    for (let i = 0; i < keys.length; i += 50) batches.push(keys.slice(i, i + 50));

    const requests = batches.map(batch => {
      const jql = `key in (${batch.join(',')})`;
      return this.http.get<JiraSearchResult>(`${this.base}/rest/api/3/search/jql`, {
        headers: this.headers,
        params: new HttpParams()
          .set('jql', jql)
          .set('maxResults', 50)
          .set('fields', 'summary,status,priority,assignee,reporter,issuetype,created,updated'),
      }).pipe(
        map(r => r.issues.map(i => this.mapIssue(i))),
        catchError(() => of([] as JiraTicket[]))
      );
    });

    return forkJoin(requests).pipe(map(results => results.flat()));
  }

  testConnection(): Observable<boolean> {
    return this.http.get(`${this.base}/rest/api/2/myself`, { headers: this.headers }).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  getTicketUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }
}
