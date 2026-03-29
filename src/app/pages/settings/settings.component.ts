import { Component, OnInit, signal, inject, effect } from '@angular/core';
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
import { AuthConfigService, AppConfig } from '../../core/services/auth-config.service';
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
    MatProgressSpinnerModule, MatTooltipModule,
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
})
export class SettingsComponent implements OnInit {
  private fb = inject(FormBuilder);
  firebase = inject(FirebaseService);
  
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
    this.jira.testConnection().subscribe(ok => {
      this.jiraTesting.set(false);
      this.jiraStatus.set(ok ? 'ok' : 'fail');
      ok
        ? this.notify.success('JIRA connection successful!')
        : this.notify.error('JIRA connection failed. Check base URL, email, and token.');
    });
  }

  getError(ctrl: string, label: string): string {
    const c = this.form.get(ctrl);
    if (!c?.touched || !c?.errors) return '';
    if (c.errors['required']) return `${label} is required`;
    if (c.errors['email']) return 'Enter a valid email address';
    return '';
  }
}
