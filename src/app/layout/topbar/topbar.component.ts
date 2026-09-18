import {
  Component,
  computed,
  inject,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthConfigService } from '../../core/services/auth-config.service';
import { ApiDocsDialogComponent } from '../../shared/components/api-docs-dialog/api-docs-dialog.component';
import { McpDocsDialogComponent } from '../../shared/components/mcp-docs-dialog/mcp-docs-dialog.component';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/pr-review': 'PR Review',
  '/pr-creation': 'Create Pull Requests',
  '/branch-compare': 'Branch / Tag Compare',
  '/token-gen': 'IAM Tokens',
  '/feature-toggles': 'Feature Toggles Comparison',
  '/settings': 'Settings',
};

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDialogModule
  ],
  templateUrl: './topbar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./topbar.component.scss'],
})
export class TopbarComponent {
  @Output() toggleSidebar = new EventEmitter<void>();
  private router = inject(Router);
  private dialog = inject(MatDialog);

  private navEnd = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd)));

  pageTitle = computed(() => {
    this.navEnd(); // reactive dependency
    return PAGE_TITLES[this.router.url.split('?')[0]] || 'Dev Helper';
  });

  workspace = computed(() => this.authConfig.config().bitbucketWorkspace || null);

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
