import { Injectable, signal, inject } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { AuthSessionService } from './auth-session.service';

export interface AppConfig {
  // Bitbucket Cloud
  bitbucketWorkspace: string;
  bitbucketToken: string;           // App password or access token
  bitbucketBaseUrl: string;         // https://api.bitbucket.org/2.0
  /** Default branch used as the comparison base (e.g. 'main', 'develop') */
  bitbucketDefaultBranch: string;

  // JIRA
  jiraBaseUrl: string;              // e.g. https://company.atlassian.net
  jiraEmail: string;
  jiraToken: string;
  jiraAccountId: string;

  jiraTicketPattern: string;        // Regex pattern, default [A-Z]+-\d+

  // Gemini AI Code Review
  geminiApiKey: string;

  // NOTE: keycloakEnvs intentionally removed — now globally shared.
  // Access via AuthConfigService.keycloakEnvs signal.
}

export interface KeycloakEnvConfig {
  envName: string;
  baseUrl: string;
  realm: string;
  clientId: string;
  username: string;
  password?: string;
}

export interface ArgocdEnvConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password?: string;
}

/** A single entry in the dynamic global Service Registry */
export interface ServiceRegistryEntry {
  /** Unique key, e.g. BM_INVOICE */
  key: string;
  /** Human-readable label shown in the UI */
  displayName: string;
  /** Bitbucket project KEY */
  project: string;
  /** Bitbucket repository slug */
  repository: string;
  /** Comma-separated alias names for matching */ 
  aliases: string[];
  /** Optional stream name for filtering */
  stream?: string;
}

const STORAGE_KEY = 'dev_helper_config';

const DEFAULTS: AppConfig = {
  bitbucketWorkspace: '',
  bitbucketToken: '',
  // Actual Bitbucket server URL — used for browse links and sent to the Python proxy.
  // The Angular services call /python-ai/bitbucket/* directly; this value is forwarded
  // server-side by the proxy, so browser CORS restrictions never apply.
  bitbucketBaseUrl: '',
  bitbucketDefaultBranch: 'main',
  // Actual Jira server URL — used for browse links and sent to the Python proxy.
  jiraBaseUrl: '',
  jiraEmail: '',
  jiraToken: '',
  jiraAccountId: '',
  jiraTicketPattern: '[A-Z]+-\\d+',
  geminiApiKey: '',
};

@Injectable({ providedIn: 'root' })
export class AuthConfigService {
  private _config = signal<AppConfig>({ ...DEFAULTS });
  /** Global shared Keycloak environments — accessible to every logged-in user. */
  private _keycloakEnvs = signal<KeycloakEnvConfig[]>([]);
  private _argocdEnvs = signal<ArgocdEnvConfig[]>([]);
  private _serviceRegistry = signal<ServiceRegistryEntry[]>([]);

  config = this._config.asReadonly();
  keycloakEnvs = this._keycloakEnvs.asReadonly();
  argocdEnvs = this._argocdEnvs.asReadonly();
  serviceRegistry = this._serviceRegistry.asReadonly();

  private firebase = inject(FirebaseService);
  private sessionLoader: AuthSessionService | null = null;

  constructor() { 
    // Load global shared configurations once at app startup
    this.loadGlobalKeycloak();
    this.loadGlobalArgocd();
    this.loadGlobalServiceRegistry();
  }

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

    // 1. Load per-user private config from Firebase
    this.firebase.loadCredentials(s.username, s.domain).then(cloud => {
      if (cloud && Object.keys(cloud).length > 0) {
        const merged = { ...this._config(), ...cloud };
        this._config.set(merged);
      }
    }).catch();

    // 2. Load global shared Keycloak app envs (independent of user)
    this.loadGlobalKeycloak();
    this.loadGlobalArgocd();
    this.loadGlobalServiceRegistry();
  }

  /** Reload global Keycloak envs from Firebase global/keycloak document. */
  loadGlobalKeycloak(): void {
    this.firebase.loadGlobalKeycloakEnvs().then(envs => {
      this._keycloakEnvs.set(envs);
    }).catch();
  }

  /** Save global Keycloak envs — persists to shared global/keycloak document. */
  saveGlobalKeycloak(envs: KeycloakEnvConfig[]): void {
    this._keycloakEnvs.set(envs);
    this.firebase.saveGlobalKeycloakEnvs(envs);
  }

  /** Reload global ArgoCD envs from Firebase global/argocd document. */
  loadGlobalArgocd(): void {
    this.firebase.loadGlobalArgocdEnvs().then(envs => {
      this._argocdEnvs.set(envs);
    }).catch();
  }

  /** Save global ArgoCD envs — persists to shared global/argocd document. */
  saveGlobalArgocd(envs: ArgocdEnvConfig[]): void {
    this._argocdEnvs.set(envs);
    this.firebase.saveGlobalArgocdEnvs(envs);
  }

  /** Reload global Service Registry entries from Firebase global/serviceRegistry document. */
  loadGlobalServiceRegistry(): void {
    this.firebase.loadGlobalServiceRegistry().then(entries => {
      this._serviceRegistry.set(entries);
    }).catch();
  }

  /** Save global Service Registry entries — persists to shared global/serviceRegistry document. */
  saveGlobalServiceRegistry(entries: ServiceRegistryEntry[]): void {
    this._serviceRegistry.set(entries);
    this.firebase.saveGlobalServiceRegistry(entries);
  }

  save(config: Partial<AppConfig>): void {
    const s = this.sessionLoader?.session();
    if (!s || !s.username || !s.domain) return;

    const merged = { ...this._config(), ...config };
    this._config.set(merged);

    // Persist only private user config — keycloakEnvs excluded
    const { ...privateConfig } = merged;
    this.firebase.saveCredentials(privateConfig, s.username, s.domain);
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
