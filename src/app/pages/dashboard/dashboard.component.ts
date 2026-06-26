import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthConfigService } from '../../core/services/auth-config.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, MatCardModule, MatIconModule, MatButtonModule, MatProgressBarModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
})
export class DashboardComponent {
  isConfigured = computed(() => this.authConfig.isConfigured());
  workspace = computed(() => this.authConfig.config().bitbucketWorkspace);
  jiraUrl = computed(() => this.authConfig.config().jiraBaseUrl);

  features = [
    {
      icon: 'rate_review', title: 'PR Review', route: '/pr-review',
      description: 'Analyze pull requests for missing JIRA tickets, open issues, and code gaps.',
      color: '#39c5cf',
    },
    {
      icon: 'compare_arrows', title: 'Branch Compare', route: '/branch-compare',
      description: 'Compare branches or tags, view commits, and check JIRA ticket statuses.',
      color: '#bc8cff',
    },
    {
      icon: 'assignment', title: 'My Tickets', route: '/my-tickets',
      description: 'View and manage your assigned JIRA tickets.',
      color: '#4caf50',
    },
    {
      icon: 'analytics', title: 'Gap Analysis', route: '/gap-analysis',
      description: 'Analyze gaps and view comprehensive metrics.',
      color: '#ff9800',
    },
    {
      icon: 'cloud_sync', title: 'ArgoCD Dashboard', route: '/argocd-dashboard',
      description: 'Monitor your deployments via ArgoCD.',
      color: '#2196f3',
    },
    {
      icon: 'data_object', title: 'JSON Viewer', route: '/json-viewer',
      description: 'Format, validate, and explore JSON data.',
      color: '#9c27b0',
    },
    {
      icon: 'transform', title: 'Base64 Viewer', route: '/base64-viewer',
      description: 'Encode and decode Base64 strings easily.',
      color: '#e91e63',
    },
    {
      icon: 'vpn_key', title: 'Token Gen', route: '/token-gen',
      description: 'Generate various tokens for local development.',
      color: '#607d8b',
    },
    {
      icon: 'settings', title: 'Settings', route: '/settings',
      description: 'Configure your Bitbucket and JIRA API credentials and workspace.',
      color: '#f0883e',
    },
  ];

  constructor(private authConfig: AuthConfigService) {}
}
