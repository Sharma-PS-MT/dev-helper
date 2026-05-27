import { Injectable } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { BitbucketService } from './bitbucket.service';
import { GapServiceState } from './gap-analysis-state.service';
import { BranchGapAnalysis, CommitWithTickets } from '../models/bitbucket.models';

export type GapStatus = 'NEW_ADDED' | 'REMOVING' | 'DIFF_COMMIT' | 'DIFF_COMMIT_MESSAGE';

export interface GapEntry {
  ticketId: string;
  commitSha: string;
  commitMessage: string;
  direction: 'Forward' | 'Reverse' | 'Both';
  status: GapStatus;
  actionImpact: string;
  author?: string;
  jiraStatus?: string;
  ticketUrl?: string;
}

export interface ServiceGapResult {
  serviceName: string;
  sourceEnv: string;
  targetEnv: string;
  gaps: GapEntry[];
}

@Injectable({ providedIn: 'root' })
export class GapAnalysisEngineService {
  constructor(private bitbucket: BitbucketService) {}

  processGaps(sourceEnv: string, targetEnv: string, services: GapServiceState[]): Observable<ServiceGapResult[]> {
    if (services.length === 0) {
      return of([]);
    }

    const requests = services.map(service => {
      // If either version is unknown, we can't properly compare
      if (!service.sourceVersion || service.sourceVersion === '—' || !service.targetVersion || service.targetVersion === '—') {
        return of({
          serviceName: service.appName,
          sourceEnv,
          targetEnv,
          gaps: []
        } as ServiceGapResult);
      }

      return this.bitbucket.analyzeGap(service.repository, service.sourceVersion, service.targetVersion, service.project).pipe(
        map((analysis: BranchGapAnalysis) => {
          const gaps: GapEntry[] = [];

          // Forward Gaps (NEW_ADDED)
          analysis.criticalCommits.forEach(cwt => {
            gaps.push(this.mapCommitToGap(cwt, 'Forward', 'NEW_ADDED', `Will be introduced to ${targetEnv}.`));
          });

          // Reverse Gaps (REMOVING)
          analysis.incomingCommits.forEach(cwt => {
            gaps.push(this.mapCommitToGap(cwt, 'Reverse', 'REMOVING', `Alert: This code is missing from ${sourceEnv} and will be deleted from ${targetEnv}.`));
          });

          return {
            serviceName: service.appName,
            sourceEnv,
            targetEnv,
            gaps
          };
        }),
        catchError(err => {
          console.error(`Failed to analyze gap for ${service.appName}`, err);
          return of({
            serviceName: service.appName,
            sourceEnv,
            targetEnv,
            gaps: [{
              ticketId: 'ERROR',
              commitSha: 'N/A',
              commitMessage: `Failed to fetch gap analysis from Bitbucket: ${err.message || 'Unknown error'}`,
              direction: 'Both',
              status: 'DIFF_COMMIT_MESSAGE', // Use this as an error indicator
              actionImpact: 'API Request Failed'
            }]
          } as ServiceGapResult);
        })
      );
    });

    return forkJoin(requests);
  }

  private mapCommitToGap(cwt: CommitWithTickets, direction: 'Forward' | 'Reverse', status: GapStatus, actionImpact: string): GapEntry {
    let ticketId = 'No Ticket';
    if (cwt.ticketIds && cwt.ticketIds.length > 0) {
      ticketId = cwt.ticketIds.join(', ');
    }

    const author = cwt.commit.author?.user?.display_name || cwt.commit.author?.raw?.split('<')[0]?.trim() || 'Unknown';
    const jiraStatus = cwt.tickets?.length > 0 
      ? cwt.tickets.map(t => t.status?.name || 'Unknown').join(', ') 
      : 'N/A';
    
    // We can assume Jira base URL from AuthConfig if needed, but JiraTicket might already have url
    // For now, if t.url is missing, we'll construct it in the component if we have the base URL
    const ticketUrl = cwt.tickets?.find(t => t.url)?.url || '';

    return {
      ticketId,
      commitSha: cwt.commit.hash.substring(0, 8),
      commitMessage: cwt.commit.message.split('\n')[0], // First line of commit message
      direction,
      status,
      actionImpact,
      author,
      jiraStatus,
      ticketUrl
    };
  }
}
