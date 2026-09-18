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

export interface Hospital {
  id: number | string;
  hospitalName: string;
}

export interface HospitalResponse {
  hospitals: Hospital[];
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  [key: string]: any;
}

// Proxied through the local Python FastAPI server (/python-ai/feature-flags)
// to bypass browser CORS and network restrictions.
const PROXY_BASE = '/python-ai/feature-flags';

@Injectable({ providedIn: 'root' })
export class FeatureToggleService {
  private http = inject(HttpClient);

  /**
   * Acquires the Keycloak token from Python proxy.
   */
  acquireToken(config: KeycloakEnvConfig): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(`${PROXY_BASE}/token`, config);
  }

  /**
   * Calls the Python backend proxy (/python-ai/feature-flags/query),
   * which handles Keycloak authentication and fetches feature flags server-side.
   */
  fetchFeatureFlags(config: KeycloakEnvConfig, token?: string): Observable<FeatureFlag[]> {
    return this.http
      .post<FeatureFlagResponse>(`${PROXY_BASE}/query`, { config, token })
      .pipe(
        map((res) => {
          const rawFlags = res?.flags || [];
          return rawFlags.map((f) => {
            const { variants, defaultVariant, ...rest } = f;
            return {
              ...rest,
              flag: (f.flag || '').trim(),
            };
          });
        }),
      );
  }

  /**
   * Calls the Python backend proxy (/python-ai/feature-flags/hospitals)
   * to fetch general hospital details from CSI masterdata.
   */
  fetchHospitals(config: KeycloakEnvConfig, token?: string): Observable<Hospital[]> {
    return this.http
      .post<HospitalResponse>(`${PROXY_BASE}/hospitals`, { config, token })
      .pipe(map((res) => res?.hospitals || []));
  }
}
