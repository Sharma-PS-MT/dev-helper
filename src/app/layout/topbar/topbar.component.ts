import { Component, computed, inject, Output, EventEmitter } from '@angular/core';
import { Router, NavigationEnd, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthConfigService } from '../../core/services/auth-config.service';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/pr-review': 'PR Review',
  '/pr-creation': 'Create Pull Requests',
  '/branch-compare': 'Branch / Tag Compare',
  '/settings': 'Settings',
};

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss'],
})
export class TopbarComponent {
  @Output() toggleSidebar = new EventEmitter<void>();
  private router = inject(Router);
  
  private navEnd = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd))
  );

  pageTitle = computed(() => {
    this.navEnd(); // reactive dependency
    return PAGE_TITLES[this.router.url.split('?')[0]] || 'Dev Helper';
  });

  workspace = computed(() => this.authConfig.config().bitbucketWorkspace || null);

  constructor(
    private authConfig: AuthConfigService,
  ) {}
}
