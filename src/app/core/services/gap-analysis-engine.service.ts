import { Injectable } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { BitbucketService } from './bitbucket.service';
import { GapServiceState } from './gap-analysis-state.service';
import { BranchGapAnalysis, CommitWithTickets } from '../models/bitbucket.models';

export type GapStatus = 'NEW_ADDED' | 'REMOVED' | 'DIFF_COMMIT' | 'DIFF_MESSAGE';

export interface GapEntry {
  ticketId: string;
  commitMessage: string;
  status: GapStatus;
  actionImpact: string;
  author?: string;
  jiraStatus?: string;
  ticketUrl?: string;
  isGrouped?: false;
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
            gaps.push(...this.mapCommitToGaps(cwt, 'Forward', 'NEW_ADDED', `Will be introduced to ${targetEnv}.`));
          });

          // Reverse Gaps (REMOVED)
          analysis.incomingCommits.forEach(cwt => {
            gaps.push(...this.mapCommitToGaps(cwt, 'Reverse', 'REMOVED', `Alert: This code is missing from ${sourceEnv} and will be deleted from ${targetEnv}.`));
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
              commitMessage: `Failed to fetch gap analysis from Bitbucket: ${err.message || 'Unknown error'}`,
              status: 'DIFF_MESSAGE', // Use this as an error indicator
              actionImpact: 'API Request Failed'
            }]
          } as ServiceGapResult);
        })
      );
    });

    return forkJoin(requests);
  }

  private mapCommitToGaps(cwt: CommitWithTickets, direction: 'Forward' | 'Reverse', status: GapStatus, actionImpact: string): GapEntry[] {
    const author = cwt.commit.author?.user?.display_name || cwt.commit.author?.raw?.split('<')[0]?.trim() || 'Unknown';
    const commitMessage = cwt.commit.message.split('\n')[0];
    const ticketIds = cwt.ticketIds && cwt.ticketIds.length > 0 ? cwt.ticketIds : ['No Ticket'];
    const ticketMap = new Map((cwt.tickets || []).map(ticket => [ticket.key, ticket]));

    return ticketIds.map(ticketId => {
      const jiraTicket = ticketMap.get(ticketId);
      const jiraStatus = ticketId === 'No Ticket'
        ? 'N/A'
        : jiraTicket?.status?.name || 'Not Found in Jira';

      return {
        ticketId,
        commitMessage,
        status,
        actionImpact,
        author,
        jiraStatus,
        ticketUrl: jiraTicket?.url || '',
      };
    });
  }
}
