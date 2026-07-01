import { Component, OnInit, signal, inject, effect, computed } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, Validators, AbstractControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { AuthConfigService, AppConfig, ArgocdEnvConfig, ServiceRegistryEntry } from '../../core/services/auth-config.service';
import { JiraService } from '../../core/services/jira.service';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { FirebaseService } from '../../core/services/firebase.service';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { AuthSessionService } from '../../core/services/auth-session.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatDividerModule,
    MatProgressSpinnerModule, MatTooltipModule, MatTableModule, MatChipsModule,
    MatSelectModule,
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private route = inject(ActivatedRoute);
  firebase = inject(FirebaseService);
  
  activeCategory = signal<string>('bitbucket');

  form = this.fb.group({
    bitbucketWorkspace: [''],
    bitbucketToken: [''],
    bitbucketBaseUrl: ['/bitbucket-api'],
    bitbucketDefaultBranch: ['main'],
    jiraBaseUrl: ['/jira-api'],
    jiraEmail: ['', Validators.email],
    jiraToken: [''],
    jiraTicketPattern: ['[A-Z]+-\\d+'],
    geminiApiKey: [''],
    openaiBaseUrl: ['https://openrouter.ai/api/v1'],
    openaiApiKey: [''],
    openaiModel: [''],
    openaiMaxTokens: [4096, [Validators.min(1), Validators.max(100000)]],
  });

  showBitToken = signal(false);
  showJiraToken = signal(false);
  showGeminiToken = signal(false);
  showOpenaiToken = signal(false);
  bitbucketTesting = signal(false);
  jiraTesting = signal(false);
  openaiConnecting = signal(false);
  openaiConnected = signal(false);
  openaiError = signal('');
  openaiModels = signal<{ id: string; name: string }[]>([]);
  modelSearchQuery = signal<string>('');
  filteredOpenaiModels = computed(() => {
    const q = this.modelSearchQuery().toLowerCase().trim();
    if (!q) return this.openaiModels();
    return this.openaiModels().filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
  });
  bitbucketStatus = signal<'idle' | 'ok' | 'fail'>('idle');
  jiraStatus = signal<'idle' | 'ok' | 'fail'>('idle');

  // ArgoCD Global table logic
  argocdColumns = ['name', 'url', 'username', 'password', 'actions'];
  argocdEnvs = computed(() => this.authConfig.argocdEnvs());
  
  newArgoEnv: ArgocdEnvConfig = this.emptyArgoEnv();
  showArgoPwd: { [key: string]: boolean } = {};

  // Service Registry global table logic
  svcColumns = ['displayName', 'stream', 'project', 'repository', 'aliases', 'actions'];
  serviceRegistry = computed(() => this.authConfig.serviceRegistry());
  newSvcEntry: ServiceRegistryEntry = this.emptySvcEntry();
  newAliasInput: { [key: string]: string } = {};
  newSvcAlias = '';
  editingAliases: { [key: string]: string } = {};

  constructor(
    private authConfig: AuthConfigService,
    private jira: JiraService,
    private bitbucket: BitbucketService,
    private notify: NotificationService,
    private http: HttpClient,
    public session: AuthSessionService
  ) {
    // Explicitly react to Firebase resolving properties asynchronously
    effect(() => {
      const c = this.authConfig.config();
      this.form.patchValue({
        bitbucketWorkspace: c.bitbucketWorkspace,
        bitbucketToken: c.bitbucketToken,
        bitbucketBaseUrl: c.bitbucketBaseUrl || '/bitbucket-api',
        bitbucketDefaultBranch: c.bitbucketDefaultBranch || 'main',
        jiraBaseUrl: c.jiraBaseUrl || '/jira-api',
        jiraEmail: c.jiraEmail,
        jiraToken: c.jiraToken,
        jiraTicketPattern: c.jiraTicketPattern || '[A-Z]+-\\d+',
        geminiApiKey: c.geminiApiKey || '',
        openaiBaseUrl: c.openaiBaseUrl || 'https://openrouter.ai/api/v1',
        openaiApiKey: c.openaiApiKey || '',
        openaiModel: c.openaiModel || '',
        openaiMaxTokens: c.openaiMaxTokens || 4096,
      });
      // Restore connected state if a model is already saved
      if (c.openaiBaseUrl && c.openaiApiKey && c.openaiModel) {
        this.openaiConnected.set(true);
        // Pre-fetch models asynchronously since we have the key & url
        this.fetchModelsSilently(c.openaiBaseUrl, c.openaiApiKey);
      }
    });

    this.route.paramMap.subscribe(params => {
      const cat = params.get('category');
      if (cat) this.activeCategory.set(cat);
    });
  }

  ngOnInit(): void {}

  save(): boolean {
    if (this.form.invalid) { 
      this.form.markAllAsTouched(); 
      this.notify.error('Please fix form errors before saving.');
      return false; 
    }
    this.authConfig.save(this.form.value as Partial<AppConfig>);
    this.notify.success('Configuration saved successfully!');
    return true;
  }

  connectOpenAI(): void {
    const baseUrl = this.form.get('openaiBaseUrl')?.value?.trim();
    const apiKey = this.form.get('openaiApiKey')?.value?.trim();
    if (!baseUrl) {
      this.openaiError.set('Please enter the OpenAI-compatible Base URL.');
      return;
    }
    if (!apiKey) {
      this.openaiError.set('Please enter your API key.');
      return;
    }
    this.openaiConnecting.set(true);
    this.openaiConnected.set(false);
    this.openaiError.set('');
    this.openaiModels.set([]);

    this.http.post<any>('/python-ai/openai/models', {
      base_url: baseUrl,
      api_key: apiKey
    }).pipe(
      catchError((err) => {
        this.openaiConnecting.set(false);
        this.openaiError.set(err.error?.detail || 'Connection failed. Check your API key/URL and try again.');
        return of(null);
      })
    ).subscribe((res: any) => {
      if (!res) return;
      this.openaiConnecting.set(false);
      
      const rawModels = res.data || [];
      let finalModels: { id: string; name: string }[] = [];

      // If it is OpenRouter, filter for free models
      if (baseUrl.toLowerCase().includes('openrouter.ai')) {
        finalModels = rawModels
          .filter((m: any) => {
            const promptPrice = parseFloat(m?.pricing?.prompt || '1');
            const completionPrice = parseFloat(m?.pricing?.completion || '1');
            return promptPrice === 0 && completionPrice === 0;
          })
          .map((m: any) => ({ id: m.id, name: m.name || m.id }));
      } else {
        // Generic OpenAI Compatible: include all models
        finalModels = rawModels.map((m: any) => ({ id: m.id, name: m.id }));
      }

      finalModels.sort((a: any, b: any) => a.name.localeCompare(b.name));
      this.openaiModels.set(finalModels);
      this.openaiConnected.set(true);
      
      // Save base URL and API key immediately
      const current = this.authConfig.config();
      this.authConfig.save({
        ...current,
        openaiBaseUrl: baseUrl,
        openaiApiKey: apiKey
      });
      this.notify.success(`Connected! ${finalModels.length} models available.`);
    });
  }

  private fetchModelsSilently(baseUrl: string, apiKey: string): void {
    this.http.post<any>('/python-ai/openai/models', {
      base_url: baseUrl,
      api_key: apiKey
    }).pipe(
      catchError(() => of(null))
    ).subscribe((res: any) => {
      if (!res) return;
      
      const rawModels = res.data || [];
      let finalModels: { id: string; name: string }[] = [];

      if (baseUrl.toLowerCase().includes('openrouter.ai')) {
        finalModels = rawModels
          .filter((m: any) => {
            const promptPrice = parseFloat(m?.pricing?.prompt || '1');
            const completionPrice = parseFloat(m?.pricing?.completion || '1');
            return promptPrice === 0 && completionPrice === 0;
          })
          .map((m: any) => ({ id: m.id, name: m.name || m.id }));
      } else {
        finalModels = rawModels.map((m: any) => ({ id: m.id, name: m.id }));
      }

      finalModels.sort((a: any, b: any) => a.name.localeCompare(b.name));
      this.openaiModels.set(finalModels);
    });
  }

  testBitbucket(): void {
    if (!this.save()) return;
    this.bitbucketTesting.set(true);
    this.bitbucketStatus.set('idle');
    this.bitbucket.getProjects().pipe(
      catchError(() => of(null))
    ).subscribe(res => {
      this.bitbucketTesting.set(false);
      if (res && res.length >= 0) {
        this.bitbucketStatus.set('ok');
        this.notify.success('Bitbucket connection successful!');
      } else {
        this.bitbucketStatus.set('fail');
        this.notify.error('Bitbucket connection failed. Check workspace and token.');
      }
    });
  }

  testJira(): void {
    if (!this.save()) return;
    this.jiraTesting.set(true);
    this.jiraStatus.set('idle');
    this.jira.getMyself().subscribe(profile => {
      this.jiraTesting.set(false);
      if (profile) {
        this.jiraStatus.set('ok');
        // Save the fetched accountId back to config & Firebase
        const currentConfig = this.authConfig.config();
        this.authConfig.save({ ...currentConfig, jiraAccountId: profile.accountId });
        this.notify.success('JIRA connection successful! Account ID synced.');
      } else {
        this.jiraStatus.set('fail');
        this.notify.error('JIRA connection failed. Check base URL, email, and token.');
      }
    });
  }

  // ===========================================================================
  // ArgoCD Config Logic
  // ===========================================================================
  
  private emptyArgoEnv(): ArgocdEnvConfig {
    return { id: '', name: '', url: '', username: '', password: '' };
  }

  addArgoEnv() {
    if (!this.newArgoEnv.name || !this.newArgoEnv.url || !this.newArgoEnv.username || !this.newArgoEnv.password) {
      this.notify.error('All fields are required for ArgoCD environment');
      return;
    }
    // basic URL validation
    if (!this.newArgoEnv.url.startsWith('http')) {
      this.notify.error('Base URL must start with http:// or https://');
      return;
    }

    const newEnv = {
      ...this.newArgoEnv,
      id: Date.now().toString()
    };
    
    const updated = [...this.argocdEnvs(), newEnv];
    this.authConfig.saveGlobalArgocd(updated);
    this.newArgoEnv = this.emptyArgoEnv();
    this.notify.success('ArgoCD Environment Added (Global)');
  }

  removeArgoEnv(envId: string) {
    if (confirm('Are you sure you want to remove this ArgoCD environment?')) {
      const updated = this.argocdEnvs().filter((e: ArgocdEnvConfig) => e.id !== envId);
      this.authConfig.saveGlobalArgocd(updated);
      this.notify.success('ArgoCD Environment Removed');
    }
  }

  saveArgoEnv(env: ArgocdEnvConfig) {
    // Save triggered (changes update in-place normally but we flush explicitly)
    const updated = this.argocdEnvs().map((e: ArgocdEnvConfig) => e.id === env.id ? env : e);
    this.authConfig.saveGlobalArgocd(updated);
    this.notify.success('ArgoCD Environment Updated (Global)');
  }

  toggleArgoPwd(id: string) {
    this.showArgoPwd[id] = !this.showArgoPwd[id];
  }

  getError(ctrl: string, label: string): string {
    const c = this.form.get(ctrl);
    if (!c?.touched || !c?.errors) return '';
    if (c.errors['required']) return `${label} is required`;
    if (c.errors['email']) return 'Enter a valid email address';
    return '';
  }

  // ===========================================================================
  // Service Registry Logic
  // ===========================================================================

  private emptySvcEntry(): ServiceRegistryEntry {
    return { key: '', displayName: '', project: '', repository: '', aliases: [], stream: '' };
  }

  /** Derive registry key from displayName: uppercase, spaces→underscores */
  private toKey(displayName: string): string {
    return displayName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  addSvcEntry() {
    const e = this.newSvcEntry;
    if (!e.displayName || !e.project || !e.repository) {
      this.notify.error('Display name, project and repository are required.');
      return;
    }
    const key = this.toKey(e.displayName);
    const existing = this.serviceRegistry().find(s => s.key === key);
    if (existing) {
      this.notify.error(`A service with key "${key}" already exists.`);
      return;
    }
    const aliases = this.newSvcAlias
      ? [...e.aliases, ...this.newSvcAlias.split(',').map(a => a.trim()).filter(Boolean)]
      : e.aliases;
    const entry: ServiceRegistryEntry = { ...e, key, aliases };
    const updated = [...this.serviceRegistry(), entry];
    this.authConfig.saveGlobalServiceRegistry(updated);
    this.newSvcEntry = this.emptySvcEntry();
    this.newSvcAlias = '';
    this.notify.success(`Service "${entry.displayName}" added to registry (Global)`);
  }

  removeSvcEntry(key: string) {
    if (confirm('Remove this service from the registry?')) {
      const updated = this.serviceRegistry().filter(s => s.key !== key);
      this.authConfig.saveGlobalServiceRegistry(updated);
      this.notify.success('Service removed from registry');
    }
  }

  saveSvcEntry(entry: ServiceRegistryEntry) {
    // flush pending alias input
    const pending = this.newAliasInput[entry.key]?.trim();
    if (pending) {
      const extra = pending.split(',').map(a => a.trim()).filter(Boolean);
      entry.aliases = [...new Set([...entry.aliases, ...extra])];
      this.newAliasInput[entry.key] = '';
    }
    const updated = this.serviceRegistry().map(s => s.key === entry.key ? { ...entry } : s);
    this.authConfig.saveGlobalServiceRegistry(updated);
    this.notify.success(`Service "${entry.displayName}" updated (Global)`);
  }

  addAliasToEntry(entry: ServiceRegistryEntry) {
    const raw = (this.newAliasInput[entry.key] || '').trim();
    if (!raw) return;
    const extra = raw.split(',').map(a => a.trim()).filter(Boolean);
    entry.aliases = [...new Set([...entry.aliases, ...extra])];
    this.newAliasInput[entry.key] = '';
    this.saveSvcEntry(entry);
  }

  removeAlias(entry: ServiceRegistryEntry, alias: string) {
    entry.aliases = entry.aliases.filter(a => a !== alias);
    this.saveSvcEntry(entry);
  }

  addAliasToNew() {
    const raw = this.newSvcAlias.trim();
    if (!raw) return;
    const extra = raw.split(',').map(a => a.trim()).filter(Boolean);
    this.newSvcEntry.aliases = [...new Set([...this.newSvcEntry.aliases, ...extra])];
    this.newSvcAlias = '';
  }

  removeAliasFromNew(alias: string) {
    this.newSvcEntry.aliases = this.newSvcEntry.aliases.filter(a => a !== alias);
  }
}
