import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { KeycloakEnvConfig } from './auth-config.service';

export interface FeatureFlagTarget {
  status: boolean;
  hospitalIds?: number[];
  [key: string]: any;
}

export interface FeatureFlagMetadata {
  toggleType?: string;
  ticketId?: string;
  releaseVersion?: string;
  description?: string;
  [key: string]: any;
}

export interface FeatureFlag {
  flag: string;
  state: 'ENABLED' | 'DISABLED' | string;
  defaultVariant?: string;
  target?: FeatureFlagTarget;
  variants?: { [key: string]: boolean };
  metadata?: FeatureFlagMetadata;
}

export interface FeatureFlagResponse {
  flags: FeatureFlag[];
}

// Proxied through the local Python FastAPI server (/python-ai/feature-flags)
// to bypass browser CORS and network restrictions.
const PROXY_BASE = '/python-ai/feature-flags';

@Injectable({ providedIn: 'root' })
export class FeatureToggleService {
  private http = inject(HttpClient);

  /**
   * Calls the Python backend proxy (/python-ai/feature-flags/query),
   * which handles Keycloak authentication and fetches feature flags server-side.
   */
  fetchFeatureFlags(config: KeycloakEnvConfig): Observable<FeatureFlag[]> {
    return this.http
      .post<FeatureFlagResponse>(`${PROXY_BASE}/query`, { config })
      .pipe(
        map((res) => {
          const rawFlags = res?.flags || [];
          return rawFlags.map((f) => ({
            ...f,
            flag: (f.flag || '').trim(),
          }));
        }),
      );
  }
}
