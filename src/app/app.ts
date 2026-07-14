import { Component, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TopbarComponent } from './layout/topbar/topbar.component';
import { AuthConfigService } from './core/services/auth-config.service';
import { AuthSessionService } from './core/services/auth-session.service';
import { LoginComponent } from './pages/login/login.component';

interface NavItem { 
  label: string; 
  icon: string; 
  path?: string; 
  badge?: string; 
  expanded?: boolean; 
  children?: NavItem[]; 
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule, RouterModule, MatSidenavModule, MatIconModule,
    MatButtonModule, MatTooltipModule, TopbarComponent, LoginComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  navItems: NavItem[] = [
    { label: 'Dashboard',      icon: 'dashboard',        path: '/dashboard' },
    { label: 'My Tickets',     icon: 'assignment_ind',   path: '/my-tickets' },
    { label: 'ArgoCD Apps',    icon: 'apps',             path: '/argocd-dashboard' },
    { label: 'PR Review',      icon: 'rate_review',      path: '/pr-review' },
    { label: 'Create PR',      icon: 'call_merge',       path: '/pr-creation' },
    { label: 'Branch Compare', icon: 'compare_arrows',   path: '/branch-compare' },
    { label: 'IAM Tokens',     icon: 'vpn_key',          path: '/token-gen' },
    { label: 'JSON Beautifier',icon: 'data_object',      path: '/json-viewer' },
    { label: 'Base64 to Image',icon: 'image',            path: '/base64-viewer' },
    { 
      label: 'Configurations', icon: 'settings', expanded: true,
      children: [
        { label: 'Service Registry', icon: 'hub', path: '/settings/service-registry' },
        { label: 'Bitbucket', icon: 'cloud', path: '/settings/bitbucket' },
        { label: 'JIRA', icon: 'bug_report', path: '/settings/jira' },
        { label: 'AI Config', icon: 'auto_awesome', path: '/settings/gemini' },
        { label: 'ArgoCD', icon: 'public', path: '/settings/argocd' },
      ]
    },
  ];

  isCollapsed = false;

  toggleExpand(item: NavItem) {
    if (this.isCollapsed) return; // Prevent expanding groups when mini
    if (item.children) {
      item.expanded = !item.expanded;
    }
  }

  toggleSidebar() {
    this.isCollapsed = !this.isCollapsed;
  }

  isConfigured = computed(() => this.authConfig.isConfigured());

  switchDomain() {
    const current = this.session.session();
    const nextDomain = current.domain === 'work' ? 'personal' : 'work';
    this.session.login(current.username, nextDomain);
  }

  constructor(private authConfig: AuthConfigService, public session: AuthSessionService) {
    this.authConfig.bindSession(this.session);
  }
}
