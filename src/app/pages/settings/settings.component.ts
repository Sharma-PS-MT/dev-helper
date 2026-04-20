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
import { AuthConfigService, AppConfig, ArgocdEnvConfig } from '../../core/services/auth-config.service';
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
    MatProgressSpinnerModule, MatTooltipModule, MatTableModule,
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
    jiraBaseUrl: ['/jira-api'],
    jiraEmail: ['', Validators.email],
    jiraToken: [''],
    jiraTicketPattern: ['[A-Z]+-\\d+'],
    geminiApiKey: [''],
  });

  showBitToken = signal(false);
  showJiraToken = signal(false);
  showGeminiToken = signal(false);
  bitbucketTesting = signal(false);
  jiraTesting = signal(false);
  bitbucketStatus = signal<'idle' | 'ok' | 'fail'>('idle');
  jiraStatus = signal<'idle' | 'ok' | 'fail'>('idle');

  // ArgoCD Global table logic
  argocdColumns = ['name', 'url', 'username', 'password', 'actions'];
  argocdEnvs = computed(() => this.authConfig.argocdEnvs());
  
  newArgoEnv: ArgocdEnvConfig = this.emptyArgoEnv();
  showArgoPwd: { [key: string]: boolean } = {};

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
        jiraBaseUrl: c.jiraBaseUrl || '/jira-api',
        jiraEmail: c.jiraEmail,
        jiraToken: c.jiraToken,
        jiraTicketPattern: c.jiraTicketPattern || '[A-Z]+-\\d+',
        geminiApiKey: c.geminiApiKey || '',
      });
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

  testBitbucket(): void {
    if (!this.save()) return;
    this.bitbucketTesting.set(true);
    this.bitbucketStatus.set('idle');
    const config = this.authConfig.config();
    this.http.get(`${config.bitbucketBaseUrl}/rest/api/1.0/projects`).pipe(
      catchError(() => of(null))
    ).subscribe(res => {
      this.bitbucketTesting.set(false);
      if (res) {
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
}
