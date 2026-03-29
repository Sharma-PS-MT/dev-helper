import { Injectable, signal, inject } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { AuthSessionService } from './auth-session.service';

export interface AppConfig {
  // Bitbucket Cloud
  bitbucketWorkspace: string;
  bitbucketToken: string;           // App password or access token
  bitbucketBaseUrl: string;         // https://api.bitbucket.org/2.0

  // JIRA
  jiraBaseUrl: string;              // e.g. https://company.atlassian.net
  jiraEmail: string;
  jiraToken: string;

  jiraTicketPattern: string;        // Regex pattern, default [A-Z]+-\d+

  // Gemini AI Code Review
  geminiApiKey: string;

  // Keycloak IAM
  keycloakEnvs: KeycloakEnvConfig[];
}

export interface KeycloakEnvConfig {
  envName: string;
  baseUrl: string;
  realm: string;
  clientId: string;
  username: string;
  password?: string;
}

const STORAGE_KEY = 'dev_helper_config';

const DEFAULTS: AppConfig = {
  bitbucketWorkspace: '',
  bitbucketToken: '',
  bitbucketBaseUrl: '/bitbucket-api',
  jiraBaseUrl: '/jira-api',
  jiraEmail: '',
  jiraToken: '',
  jiraTicketPattern: '[A-Z]+-\\d+',
  geminiApiKey: '',
  keycloakEnvs: [],
};

@Injectable({ providedIn: 'root' })
export class AuthConfigService {
  private _config = signal<AppConfig>({ ...DEFAULTS });

  config = this._config.asReadonly();
  private firebase = inject(FirebaseService);
  private sessionLoader: AuthSessionService | null = null; // injected manually on layout loads

  constructor() { }

  // Triggered right after Session connects mapping isolated payload domains
  bindSession(sessionSvc: AuthSessionService) {
    this.sessionLoader = sessionSvc;
    this.load();
  }

  private get key() {
    const s = this.sessionLoader?.session();
    if (s && s.username && s.domain) {
      return `dev_helper_config_${s.username}_${s.domain}`;
    }
    return STORAGE_KEY; // Fallback
  }

  load(): void {
    const s = this.sessionLoader?.session();
    if (!s || !s.username || !s.domain) return;

    // Reset base memory immediately on user switch
    this._config.set({ ...DEFAULTS });

    // Attempt Firebase override if network accessible
    this.firebase.loadCredentials(s.username, s.domain).then(cloud => {
      if (cloud && Object.keys(cloud).length > 0) {
        const merged = { ...this._config(), ...cloud };
        this._config.set(merged);
      }
    }).catch();
  }

  save(config: Partial<AppConfig>): void {
    const s = this.sessionLoader?.session();
    if (!s || !s.username || !s.domain) return;

    const merged = { ...this._config(), ...config };
    this._config.set(merged);

    // Asynchronously synchronize with Firebase Storage exclusively
    this.firebase.saveCredentials(merged, s.username, s.domain);
  }

  isConfigured(): boolean {
    const c = this._config();
    return !!(c.bitbucketWorkspace && c.bitbucketToken && c.jiraBaseUrl && c.jiraEmail && c.jiraToken);
  }

  get bitbucketAuthHeader(): string {
    return 'Bearer ' + this._config().bitbucketToken;
  }

  get jiraAuthHeader(): string {
    const c = this._config();
    return 'Basic ' + btoa(`${c.jiraEmail}:${c.jiraToken}`);
  }

  extractTicketIds(text: string): string[] {
    const pattern = this._config().jiraTicketPattern || DEFAULTS.jiraTicketPattern;
    try {
      const regex = new RegExp(pattern, 'g');
      return [...new Set(text.match(regex) || [])];
    } catch {
      const regex = /[A-Z]+-\d+/g;
      return [...new Set(text.match(regex) || [])];
    }
  }
}
