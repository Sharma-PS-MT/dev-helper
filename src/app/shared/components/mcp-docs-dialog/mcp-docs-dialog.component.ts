import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

interface McpToolInfo {
  name: string;
  description: string;
  parameters: string;
}

@Component({
  selector: 'app-mcp-docs-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  template: `
    <div class="mcp-docs-modal">
      <div class="modal-header">
        <div class="header-left">
          <div class="header-icon">
            <mat-icon>hub</mat-icon>
          </div>
          <div>
            <h2>CSI Helper MCP Server Integration Guide</h2>
            <p class="subtitle">Model Context Protocol for Antigravity, Claude Code & Cursor</p>
          </div>
        </div>
        <div class="header-actions">
          <button mat-icon-button (click)="close()"><mat-icon>close</mat-icon></button>
        </div>
      </div>

      <div class="modal-body">
        <!-- Step 1 -->
        <div class="step-card">
          <div class="step-header">
            <span class="step-badge">Step 1</span>
            <h3>MCP Server Configuration</h3>
            <button mat-stroked-button color="primary" (click)="copyConfig()" class="ml-auto">
              <mat-icon>{{ copiedConfig ? 'check' : 'content_copy' }}</mat-icon>
              {{ copiedConfig ? 'Copied!' : 'Copy Config JSON' }}
            </button>
          </div>
          <p class="step-desc">
            Add the following configuration to your MCP configuration file
            (<code>~/.gemini/config/mcp_config.json</code> for Antigravity, or <code>claude_desktop_config.json</code>):
          </p>
          <div class="code-box">
            <code>{{ mcpConfigJson }}</code>
          </div>
        </div>

        <!-- Step 2 -->
        <div class="step-card">
          <div class="step-header">
            <span class="step-badge">Step 2</span>
            <h3>Environment Variables</h3>
          </div>
          <p class="step-desc">The MCP server communicates with the CSI Helper REST API over HTTP:</p>
          <div class="env-table">
            <div class="env-row header">
              <span class="col-name">Variable</span>
              <span class="col-default">Default Value</span>
              <span class="col-desc">Purpose</span>
            </div>
            <div class="env-row">
              <span class="col-name"><code>CSI_HELPER_BASE_URL</code></span>
              <span class="col-default"><code>http://localhost:8000/api/v1</code></span>
              <span class="col-desc">URL of the CSI Helper FastAPI backend</span>
            </div>
            <div class="env-row">
              <span class="col-name"><code>CSI_HELPER_API_KEY</code></span>
              <span class="col-default"><code>dummy-api-key</code></span>
              <span class="col-desc">API Key header for request authorization</span>
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div class="step-card">
          <div class="step-header">
            <span class="step-badge">Step 3</span>
            <h3>Available MCP Tools (9 Tools)</h3>
          </div>
          <div class="tools-grid">
            <div class="tool-item" *ngFor="let t of tools">
              <div class="tool-name">
                <mat-icon inline class="tool-icon">terminal</mat-icon>
                <code>{{ t.name }}</code>
              </div>
              <p class="tool-desc">{{ t.description }}</p>
              <span class="tool-params">Params: {{ t.parameters }}</span>
            </div>
          </div>
        </div>

        <!-- Step 4 -->
        <div class="step-card">
          <div class="step-header">
            <span class="step-badge">Step 4</span>
            <h3>Build & Verification</h3>
          </div>
          <p class="step-desc">To rebuild or run automated tests on the MCP server:</p>
          <div class="code-box">
            <code>cd D:\\CSI\\OTHER\\csi-helper\\csi-helper-mcp&#10;npm run build&#10;node D:\\CSI\\OTHER\\csi-helper\\test_all_apis.js</code>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <span class="footer-note">CSI Helper MCP Server location: <code>D:\\CSI\\OTHER\\csi-helper\\csi-helper-mcp</code></span>
        <button mat-flat-button color="primary" (click)="close()">Close</button>
      </div>
    </div>
  `,
  styles: [`
    .mcp-docs-modal {
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
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
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
    .modal-body {
      padding: 20px 24px;
      overflow-y: auto;
      flex: 1;
    }
    .step-card {
      background: rgba(30, 41, 59, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }
    .step-badge {
      background: rgba(168, 85, 247, 0.25);
      color: #d8b4fe;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .step-header h3 {
      margin: 0;
      font-size: 15px;
      color: #f1f5f9;
      font-weight: 600;
    }
    .ml-auto { margin-left: auto; }
    .step-desc {
      margin: 0 0 10px 0;
      font-size: 13px;
      color: #94a3b8;
    }
    .code-box {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      padding: 12px 14px;
      overflow-x: auto;
    }
    .code-box code {
      background: transparent;
      padding: 0;
      color: #a5f3fc;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      white-space: pre;
    }
    code {
      background: rgba(0, 0, 0, 0.35);
      color: #38bdf8;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
    }
    .env-table {
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      overflow: hidden;
      font-size: 12px;
    }
    .env-row {
      display: flex;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      align-items: center;
    }
    .env-row.header {
      background: rgba(30, 41, 59, 0.6);
      font-weight: 600;
      color: #94a3b8;
    }
    .col-name { width: 220px; }
    .col-default { width: 250px; }
    .col-desc { flex: 1; color: #cbd5e1; }
    .tools-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 10px;
    }
    .tool-item {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      padding: 10px 12px;
    }
    .tool-name {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }
    .tool-icon {
      font-size: 14px;
      color: #c084fc;
    }
    .tool-desc {
      margin: 0 0 6px 0;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.4;
    }
    .tool-params {
      font-size: 11px;
      color: #64748b;
      font-family: 'Fira Code', monospace;
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
export class McpDocsDialogComponent {
  copiedConfig = false;

  mcpConfigJson = JSON.stringify({
    "mcpServers": {
      "csi-helper": {
        "command": "node",
        "args": [
          "D:\\\\CSI\\\\OTHER\\\\csi-helper\\\\csi-helper-mcp\\\\dist\\\\index.js"
        ],
        "env": {
          "CSI_HELPER_BASE_URL": "http://localhost:8000/api/v1",
          "CSI_HELPER_API_KEY": "dummy-api-key"
        }
      }
    }
  }, null, 2);

  tools: McpToolInfo[] = [
    {
      name: "get_env_list",
      description: "Lists all 18 ArgoCD deployment environments with URLs and aliases.",
      parameters: "search? (string)"
    },
    {
      name: "get_module_list",
      description: "Lists registered CSI services and repositories from the registry.",
      parameters: "stream?, project?, search? (string)"
    },
    {
      name: "get_streams",
      description: "Lists all stream keys and module count summaries.",
      parameters: "none"
    },
    {
      name: "get_modules_by_stream",
      description: "Lists modules belonging to a specific stream key (BM, PMS, etc.).",
      parameters: "streamKey (string, required)"
    },
    {
      name: "get_deployed_versions",
      description: "Queries deployed versions from ArgoCD across environments.",
      parameters: "environments (array), modules?, stream?, refresh?"
    },
    {
      name: "compare_deployed_versions",
      description: "Side-by-side version comparison across environments with drift detection.",
      parameters: "environments (array, min 2), modules?, stream?, refresh?"
    },
    {
      name: "analyze_release_gap",
      description: "Computes forward/reverse commits and Jira tickets between environments or tags.",
      parameters: "sourceEnv?, targetEnv?, modules?, stream?, fromRef?, toRef?"
    },
    {
      name: "compare_diff",
      description: "Unified git diff, file stats, and commits between two refs or environments.",
      parameters: "module (required), fromRef?, toRef?, sourceEnv?, targetEnv?"
    },
    {
      name: "get_pr_diff",
      description: "Retrieves unified diff and commits for a Bitbucket Pull Request.",
      parameters: "prId (required), module?, repoSlug?, projectKey?"
    },
    {
      name: "get_env_feature_toggles",
      description: "Live feature toggles via base-utility cache API with automated Keycloak auth.",
      parameters: "env (required), category?, search?, hospitalId?, moduleKey?, raw?"
    },
    {
      name: "compare_env_feature_toggles",
      description: "Compares live feature toggles between two environments (e.g. dev vs s1-prod).",
      parameters: "env1 (required), env2 (required), category?, search?, hospitalId1?, hospitalId2?"
    },
    {
      name: "get_env_configs",
      description: "Queries live configuration cache across hospitals for arbitrary config keys.",
      parameters: "env (required), keys?, hospitalGroupId?, hospitalIds?, moduleKey?"
    }
  ];

  constructor(public dialogRef: MatDialogRef<McpDocsDialogComponent>) {}

  close(): void {
    this.dialogRef.close();
  }

  copyConfig(): void {
    navigator.clipboard.writeText(this.mcpConfigJson);
    this.copiedConfig = true;
    setTimeout(() => {
      this.copiedConfig = false;
    }, 2000);
  }
}
