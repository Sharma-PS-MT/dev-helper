import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatRadioModule } from '@angular/material/radio';
import { AuthConfigService, KeycloakEnvConfig } from '../../core/services/auth-config.service';
import { KeycloakService } from '../../core/services/keycloak.service';
import { NotificationService } from '../../core/services/notification.service';

const ENVIRONMENTS = [
  'kfsh-uat', 'kfsh-prod', 's2-prod', 's2-uat', 's3-prod', 's3-uat', 'dev', 'perf',
  'hmg-pre-prod', 'hmg-prod', 'csi-uat', 'oci-preprod', 'oci-prod', 'kauh-prod', 'kauh-uat',
  'kkuh-prod', 'kkuh-uat', 'alibaba-uat', 'alibaba-prod', 'cs-preprod', 'cs-prod', 'csi-uat2',
  'sales-poc', 'dairyah-uat', 'qauat2'
].sort();

@Component({
  selector: 'app-token-gen',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, MatCardModule,
    MatFormFieldModule, MatInputModule, MatRadioModule, MatButtonModule,
    MatIconModule, MatProgressSpinnerModule, MatTooltipModule
  ],
  templateUrl: './token-gen.component.html',
  styleUrls: ['./token-gen.component.scss']
})
export class TokenGenComponent implements OnInit {
  prodEnvs = ENVIRONMENTS.filter(e => e.includes('prod') && !e.includes('pre')).sort();
  nonProdEnvs = ENVIRONMENTS.filter(e => !this.prodEnvs.includes(e)).sort();

  selectedEnv = signal<string>('');

  form: FormGroup;
  showPassword = signal(false);
  
  generating = signal(false);
  tokenResult = signal<string>('');

  constructor(
    private fb: FormBuilder,
    private authConfig: AuthConfigService,
    private keycloak: KeycloakService,
    private notify: NotificationService
  ) {
    this.form = this.fb.group({
      baseUrl: ['', Validators.required],
      realm: ['', Validators.required],
      clientId: ['frontend-client', Validators.required],
      username: ['', Validators.required],
      password: ['', Validators.required]
    });
  }

  ngOnInit() {}

  onEnvChange(env: string) {
    this.selectedEnv.set(env);
    this.tokenResult.set('');
    const savedEnvs = this.authConfig.config().keycloakEnvs || [];
    const match = savedEnvs.find(e => e.envName === env);
    
    if (match) {
      this.form.patchValue({
        baseUrl: match.baseUrl,
        realm: match.realm,
        clientId: match.clientId || 'frontend-client',
        username: match.username,
        password: match.password || ''
      });
    } else {
      this.form.reset({ clientId: 'frontend-client' });
    }
  }

  saveConfig() {
    if (this.form.invalid || !this.selectedEnv()) {
      this.notify.error('Please select an environment and fill all required fields.');
      return;
    }
    
    const val = this.form.value;
    const newConfig: KeycloakEnvConfig = {
      envName: this.selectedEnv(),
      baseUrl: val.baseUrl,
      realm: val.realm,
      clientId: val.clientId,
      username: val.username,
      password: val.password
    };

    const currentEnvs = [...(this.authConfig.config().keycloakEnvs || [])];
    const idx = currentEnvs.findIndex(e => e.envName === this.selectedEnv());
    if (idx > -1) {
      currentEnvs[idx] = newConfig;
    } else {
      currentEnvs.push(newConfig);
    }

    this.authConfig.save({ keycloakEnvs: currentEnvs });
    this.notify.success(`Configuration for ${this.selectedEnv()} successfully bound to Firebase & Cache!`);
  }

  generate() {
    if (this.form.invalid || !this.selectedEnv()) {
      this.form.markAllAsTouched();
      return;
    }
    
    // Auto-save prior to generation explicitly saving clicks for the user
    this.saveConfig();

    this.generating.set(true);
    this.tokenResult.set('');

    const config: KeycloakEnvConfig = {
      envName: this.selectedEnv(),
      ...this.form.value
    };

    this.keycloak.generateToken(config).subscribe({
      next: (res) => {
        if (res.access_token) {
          this.tokenResult.set(res.access_token);
          this.copyToClipboard(res.access_token);
          this.notify.success('Keycloak Token generated and securely copied directly to your clipboard!');
        } else {
          this.notify.error('Response payload was valid but stripped of an access_token matrix.');
        }
        this.generating.set(false);
      },
      error: (err) => {
        this.generating.set(false);
        this.notify.error(err.error?.error_description || err.error?.error || err.message || 'Fatal generation error hit the endpoint.');
      }
    });
  }

  copyToClipboard(text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(e => console.error('Silent layout clipboard exception:', e));
    }
  }
}
