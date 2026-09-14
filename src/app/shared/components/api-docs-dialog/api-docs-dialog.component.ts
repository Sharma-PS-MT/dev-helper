import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  description: string;
  curl: string;
}

@Component({
  selector: 'app-api-docs-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTooltipModule
  ],
  template: `
    <div class="api-docs-modal">
      <div class="modal-header">
        <div class="header-left">
          <div class="header-icon">
            <mat-icon>api</mat-icon>
          </div>
          <div>
            <h2>CSI Helper REST API Documentation</h2>
            <p class="subtitle">FastAPI v4.1.0 • Swagger UI & Interactive OpenAPI</p>
          </div>
        </div>
        <div class="header-actions">
          <a mat-stroked-button color="primary" href="/python-ai/docs" target="_blank" matTooltip="Open interactive Swagger UI">
            <mat-icon>open_in_new</mat-icon> Swagger UI
          </a>
          <a mat-stroked-button href="/python-ai/redoc" target="_blank" matTooltip="Open ReDoc format">
            <mat-icon>description</mat-icon> ReDoc
          </a>
          <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
        </div>
      </div>

      <div class="modal-body">
        <!-- Connection info banner -->
        <div class="info-card">
          <div class="info-row">
            <span class="info-label">Base URL (Direct):</span>
            <code>http://localhost:8000/api/v1</code>
            <span class="info-label ml-16">Base URL (Proxied):</span>
            <code>http://localhost:4201/python-ai/api/v1</code>
          </div>
          <div class="info-row mt-8">
            <span class="info-label">Authentication Header:</span>
            <code>X-API-Key: dummy-api-key</code>
            <span class="info-sub ml-12">(Dummy key accepted for internal development)</span>
          </div>
        </div>

        <!-- Endpoints List -->
        <div class="endpoints-section">
          <h3>Available Endpoints</h3>
          <div class="endpoint-card" *ngFor="let ep of endpoints">
            <div class="endpoint-header">
              <span class="method-badge" [class.get]="ep.method === 'GET'" [class.post]="ep.method === 'POST'">
                {{ ep.method }}
              </span>
              <span class="endpoint-path">{{ ep.path }}</span>
              <span class="endpoint-summary">{{ ep.summary }}</span>
              <button mat-icon-button (click)="copyCurl(ep.curl)" [matTooltip]="copiedCurl === ep.curl ? 'Copied!' : 'Copy cURL'" class="copy-btn">
                <mat-icon>{{ copiedCurl === ep.curl ? 'check' : 'content_copy' }}</mat-icon>
              </button>
            </div>
            <p class="endpoint-desc">{{ ep.description }}</p>
            <div class="curl-box">
              <code>{{ ep.curl }}</code>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <span class="footer-note">All endpoints return JSON responses with standard HTTP status codes.</span>
        <button mat-flat-button color="primary" (click)="close()">Close</button>
      </div>
    </div>
  `,
  styles: [`
    .api-docs-modal {
      display: flex;
      flex-direction: column;
      max-height: 88vh;
      color: #e2e8f0;
      background: #0f172a;
      border-radius: 12px;
      overflow: hidden;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: rgba(30, 41, 59, 0.7);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .header-icon {
      width: 42px;
      height: 42px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #f8fafc;
    }
    .subtitle {
      margin: 2px 0 0 0;
      font-size: 12px;
      color: #94a3b8;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .modal-body {
      padding: 20px 24px;
      overflow-y: auto;
      flex: 1;
    }
    .info-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 20px;
    }
    .info-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .info-label {
      color: #94a3b8;
      font-weight: 500;
      margin-right: 8px;
    }
    .info-sub {
      color: #64748b;
      font-size: 12px;
    }
    .ml-12 { margin-left: 12px; }
    .ml-16 { margin-left: 16px; }
    .mt-8 { margin-top: 8px; }
    code {
      background: rgba(0, 0, 0, 0.35);
      color: #38bdf8;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
    }
    .endpoints-section h3 {
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin: 0 0 14px 0;
    }
    .endpoint-card {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    .endpoint-card:hover {
      border-color: rgba(59, 130, 246, 0.3);
    }
    .endpoint-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .method-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .method-badge.get {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.4);
    }
    .method-badge.post {
      background: rgba(34, 197, 94, 0.2);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.4);
    }
    .endpoint-path {
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      font-weight: 600;
      color: #f1f5f9;
    }
    .endpoint-summary {
      font-size: 13px;
      color: #94a3b8;
      flex: 1;
    }
    .copy-btn {
      color: #94a3b8;
    }
    .copy-btn:hover {
      color: #38bdf8;
    }
    .endpoint-desc {
      margin: 6px 0 10px 0;
      font-size: 12px;
      color: #cbd5e1;
    }
    .curl-box {
      background: rgba(15, 23, 42, 0.7);
      border-radius: 6px;
      padding: 8px 12px;
      overflow-x: auto;
    }
    .curl-box code {
      background: transparent;
      padding: 0;
      color: #a5f3fc;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .modal-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 24px;
      background: rgba(30, 41, 59, 0.7);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .footer-note {
      font-size: 12px;
      color: #64748b;
    }
  `]
})
export class ApiDocsDialogComponent {
  copiedCurl: string | null = null;

  endpoints: ApiEndpoint[] = [
    {
      method: 'GET',
      path: '/api/v1/environments',
      summary: 'Get all deployment environments',
      description: 'Lists all 18 configured ArgoCD clusters with URLs and aliases. Supports ?search= query.',
      curl: 'curl -X GET "http://localhost:8000/api/v1/environments" -H "X-API-Key: dummy-api-key"'
    },
    {
      method: 'GET',
      path: '/api/v1/modules',
      summary: 'Get module registry',
      description: 'Lists registered microservices and repositories. Supports ?stream=BM&search=invoice filters.',
      curl: 'curl -X GET "http://localhost:8000/api/v1/modules?stream=BM" -H "X-API-Key: dummy-api-key"'
    },
    {
      method: 'GET',
      path: '/api/v1/streams',
      summary: 'Get stream keys',
      description: 'Lists all known streams (BM, PMS, MLM, RMS, EMPI, Integrations) and their module counts.',
      curl: 'curl -X GET "http://localhost:8000/api/v1/streams" -H "X-API-Key: dummy-api-key"'
    },
    {
      method: 'GET',
      path: '/api/v1/streams/{stream_key}/modules',
      summary: 'Get modules under stream',
      description: 'Returns service registry entries for all modules belonging to a specific stream key.',
      curl: 'curl -X GET "http://localhost:8000/api/v1/streams/BM/modules" -H "X-API-Key: dummy-api-key"'
    },
    {
      method: 'GET',
      path: '/api/v1/deployments',
      summary: 'Get deployed versions',
      description: 'Queries live container image tags and sync status from ArgoCD for environments and modules.',
      curl: 'curl -X GET "http://localhost:8000/api/v1/deployments?envs=dev,vida-uat&stream=BM" -H "X-API-Key: dummy-api-key"'
    },
    {
      method: 'POST',
      path: '/api/v1/deployments/compare',
      summary: 'Compare deployed versions',
      description: 'Side-by-side version comparison across environments with automated version drift detection.',
      curl: 'curl -X POST "http://localhost:8000/api/v1/deployments/compare" -H "Content-Type: application/json" -H "X-API-Key: dummy-api-key" -d \'{"environments":["dev","vida-uat"],"stream":"BM"}\''
    },
    {
      method: 'POST',
      path: '/api/v1/release-gap',
      summary: 'Analyze release gap',
      description: 'Analyzes forward commits (features), reverse commits (regression risk), and Jira tickets between environments or tags.',
      curl: 'curl -X POST "http://localhost:8000/api/v1/release-gap" -H "Content-Type: application/json" -H "X-API-Key: dummy-api-key" -d \'{"source_env":"dev","target_env":"vida-uat","modules":["BM_APPROVAL_UI"]}\''
    },
    {
      method: 'POST',
      path: '/api/v1/diff/compare',
      summary: 'Git diff and stats compare',
      description: 'Calculates file changes, additions, deletions, commits, Jira tickets, and unified patch text.',
      curl: 'curl -X POST "http://localhost:8000/api/v1/diff/compare" -H "Content-Type: application/json" -H "X-API-Key: dummy-api-key" -d \'{"module":"BM_APPROVAL_UI","from_ref":"V4.0.2607_W4-14713_prod","to_ref":"V4.0.2609_W4-15750_dev"}\''
    },
    {
      method: 'POST',
      path: '/api/v1/diff/pr',
      summary: 'Pull Request diff',
      description: 'Retrieves unified diff, commits, and Jira tickets for a Bitbucket Server Pull Request.',
      curl: 'curl -X POST "http://localhost:8000/api/v1/diff/pr" -H "Content-Type: application/json" -H "X-API-Key: dummy-api-key" -d \'{"module":"BM_APPROVAL_UI","pr_id":1868}\''
    },
    {
      method: 'GET',
      path: '/api/v1/environments/{env}/feature-toggles',
      summary: 'Live feature toggles (Base Utility)',
      description: 'Fetches and parses live runtime FEATURE_TOGGLES from the base-utility hospital cache with Keycloak auth.',
      curl: 'curl -X GET "http://localhost:8000/api/v1/environments/s1-prod/feature-toggles?category=ops&search=SMS" -H "X-API-Key: dummy-api-key"'
    },
    {
      method: 'POST',
      path: '/api/v1/feature-toggles/compare',
      summary: 'Compare live feature toggles',
      description: 'Compares live feature toggles between two environments, highlighting differences and missing toggles.',
      curl: 'curl -X POST "http://localhost:8000/api/v1/feature-toggles/compare" -H "Content-Type: application/json" -H "X-API-Key: dummy-api-key" -d \'{"env1":"dev","env2":"s1-prod","category":"ops"}\''
    },
    {
      method: 'POST',
      path: '/api/v1/environments/{env}/configs',
      summary: 'Hospital configuration cache',
      description: 'Queries arbitrary config keys across hospitals in an environment via the base utility API.',
      curl: 'curl -X POST "http://localhost:8000/api/v1/environments/s1-prod/configs" -H "Content-Type: application/json" -H "X-API-Key: dummy-api-key" -d \'{"keys":["FEATURE_TOGGLES"],"hospital_group_id":"110"}\''
    }
  ];

  constructor(public dialogRef: MatDialogRef<ApiDocsDialogComponent>) {}

  close(): void {
    this.dialogRef.close();
  }

  copyCurl(text: string): void {
    navigator.clipboard.writeText(text);
    this.copiedCurl = text;
    setTimeout(() => {
      if (this.copiedCurl === text) this.copiedCurl = null;
    }, 2000);
  }
}
