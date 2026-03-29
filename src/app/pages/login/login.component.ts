import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthSessionService, WorkspaceDomain } from '../../core/services/auth-session.service';
import { AuthConfigService } from '../../core/services/auth-config.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatInputModule, 
    MatFormFieldModule, MatButtonModule, MatIconModule
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  username = signal<string>('');
  selectedDomain = signal<WorkspaceDomain>('work');

  constructor(
    private session: AuthSessionService,
    private config: AuthConfigService
  ) {}

  selectDomain(domain: WorkspaceDomain) {
    this.selectedDomain.set(domain);
  }

  submit() {
    const un = this.username().trim();
    const dom = this.selectedDomain();
    
    if (!un || !dom) return;

    // Authenticate and construct paths natively
    this.session.login(un, dom);
    
    // Trigger explicit config fetch from explicit multi-tenant path
    this.config.load();
  }
}
