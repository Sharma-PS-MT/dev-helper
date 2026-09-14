import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { AuthConfigService } from '../../core/services/auth-config.service';
import { ApiDocsDialogComponent } from '../../shared/components/api-docs-dialog/api-docs-dialog.component';
import { McpDocsDialogComponent } from '../../shared/components/mcp-docs-dialog/mcp-docs-dialog.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatDialogModule
  ],
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

  private dialog = inject(MatDialog);

  constructor(private authConfig: AuthConfigService) {}

  openApiDocs(): void {
    this.dialog.open(ApiDocsDialogComponent, {
      width: '1000px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      panelClass: 'dark-dialog'
    });
  }

  openMcpDocs(): void {
    this.dialog.open(McpDocsDialogComponent, {
      width: '1000px',
      maxWidth: '95vw',
      maxHeight: '90vh',
      panelClass: 'dark-dialog'
    });
  }
}
