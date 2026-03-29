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
      icon: 'settings', title: 'Settings', route: '/settings',
      description: 'Configure your Bitbucket and JIRA API credentials and workspace.',
      color: '#f0883e',
    },
  ];

  constructor(private authConfig: AuthConfigService) {}
}
