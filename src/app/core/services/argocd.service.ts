import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { ArgocdEnvConfig } from './auth-config.service';

export interface ArgoAppModel {
  envId: string;
  envName: string;
  name: string;
  namespace: string;
  syncStatus: string;
  healthStatus: string;
  syncTag: string;
  lastSyncedAt: string;
}

// All ArgoCD calls are proxied through the local Python FastAPI server
// to bypass browser CORS restrictions. Flow: Angular → Python proxy → ArgoCD
const PROXY_BASE = '/python-ai/argocd';

@Injectable({ providedIn: 'root' })
export class ArgocdService {
  constructor(private http: HttpClient) {}

  /**
   * Two-step flow via Python proxy (no direct browser → ArgoCD calls):
   * 1. POST /python-ai/argocd/session  → gets ArgoCD token
   * 2. POST /python-ai/argocd/applications → gets applications list
   */
  fetchApplicationsForEnv(env: ArgocdEnvConfig): Observable<ArgoAppModel[]> {
    if (!env.url || !env.username || !env.password) {
      return throwError(() => new Error(`Missing credentials for environment "${env.name}"`));
    }

    // Step 1: Authenticate via proxy
    return this.http.post<{ token: string }>(`${PROXY_BASE}/session`, {
      argocd_url: env.url,
      username: env.username,
      password: env.password
    }).pipe(
      switchMap(sessionRes => {
        if (!sessionRes?.token) {
          throw new Error(`No token returned for environment "${env.name}"`);
        }
        // Step 2: Fetch apps via proxy, passing the token
        return this.http.post<{ items: any[] }>(`${PROXY_BASE}/applications`, {
          argocd_url: env.url,
          token: sessionRes.token
        });
      }),
      map(appsRes => {
        const items = appsRes?.items || [];
        return items.map(app => this.mapArgocdApp(app, env));
      }),
      catchError(err => {
        console.error(`ArgoCD fetch error for env "${env.name}"`, err);
        const message = err?.error?.detail || err?.message || `Failed to connect to "${env.name}"`;
        return throwError(() => new Error(message));
      })
    );
  }

  private mapArgocdApp(raw: any, env: ArgocdEnvConfig): ArgoAppModel {
    // Extract syncTag from images, ignoring csi-data-migration-initiator
    let extractedSyncTag = raw.spec?.source?.targetRevision || 'HEAD';
    const images: string[] = raw.status?.summary?.images || [];
    
    // Find first image not containing 'csi-data-migration-initiator'
    const targetImage = images.find(img => !img.includes('csi-data-migration-initiator'));
    if (targetImage) {
      const parts = targetImage.split(':');
      if (parts.length > 1) {
         // Get the tag part (after the last colon usually)
         extractedSyncTag = parts.slice(1).join(':'); 
      }
    }

    return {
      envId: env.id,
      envName: env.name,
      name: raw.metadata?.name || 'Unknown',
      namespace: raw.spec?.destination?.namespace || 'Unknown',
      syncStatus: raw.status?.sync?.status || 'Unknown',
      healthStatus: raw.status?.health?.status || 'Unknown',
      syncTag: extractedSyncTag,
      lastSyncedAt: raw.status?.operationState?.finishedAt || '',
    };
  }
}
