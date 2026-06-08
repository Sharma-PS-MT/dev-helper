import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { Subject, Observable, forkJoin } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface VersionSelectDialogData {
  appName: string;
  repository: string;
  project: string;
  currentVersion: string;
}

@Component({
  selector: 'app-version-select-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule,
    MatIconModule, MatInputModule, MatFormFieldModule, MatButtonToggleModule,
    MatProgressSpinnerModule, MatListModule
  ],
  template: `
    <div class="version-dialog">
      <div class="dialog-header">
        <h2><mat-icon>commit</mat-icon> Select Version</h2>
        <p>Service: {{ data.appName }}</p>
      </div>

      <div class="dialog-body">
        <!-- Branch/Tag Toggle -->
        <div class="ref-type-toggle">
          <button mat-button 
                  [class.active]="refType() === 'branch'"
                  (click)="onTypeChange('branch')">
            <mat-icon>account_tree</mat-icon> Branch
          </button>
          <button mat-button 
                  [class.active]="refType() === 'tag'"
                  (click)="onTypeChange('tag')">
            <mat-icon>sell</mat-icon> Tag
          </button>
        </div>

        <mat-form-field appearance="outline" class="search-field">
          <mat-label>Search {{ refType() === 'branch' ? 'Branches' : 'Tags' }}</mat-label>
          <input matInput [ngModel]="searchText()" (ngModelChange)="onSearchChange($event)" placeholder="Type to search..." autofocus>
          <mat-icon matPrefix>search</mat-icon>
          <button *ngIf="searchText()" matSuffix mat-icon-button aria-label="Clear" (click)="onSearchChange('')">
            <mat-icon>close</mat-icon>
          </button>
        </mat-form-field>

        <div class="results-container" (scroll)="onScroll($event)">
          <mat-spinner *ngIf="loading() && options().length === 0" diameter="40"></mat-spinner>
          
          <mat-action-list *ngIf="options().length > 0">
            <button mat-list-item *ngFor="let opt of options()" 
                    (click)="selectRef(opt.displayId || opt.name)"
                    [class.selected]="(opt.displayId || opt.name) === data.currentVersion"
                    class="ref-item">
              <mat-icon matListItemIcon>{{ refType() === 'branch' ? 'account_tree' : 'sell' }}</mat-icon>
              <span matListItemTitle class="ref-title">{{ opt.displayId || opt.name }}</span>
              <span matListItemLine class="commit-hash">{{ (opt.latestCommit || opt.latestChangeset)?.substring(0,8) }}</span>
            </button>
          </mat-action-list>

          <div *ngIf="loading() && options().length > 0" class="loading-more">
            <mat-spinner diameter="24"></mat-spinner>
            <span>Loading more...</span>
          </div>

          <div *ngIf="!loading() && options().length === 0" class="no-results">
            No {{ refType() }}es found matching "{{ searchText() }}"
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button mat-button (click)="close()">Cancel</button>
      </div>
    </div>
  `,
  styles: [`
    .version-dialog {
      background: var(--bg-secondary);
      color: var(--text-primary);
      min-width: 450px;
    }
    .dialog-header {
      padding: 24px 24px 16px;
      border-bottom: 1px solid var(--border-color);
      h2 { margin: 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
      mat-icon { color: var(--accent-cyan); }
      p { margin: 4px 0 0; color: var(--text-secondary); font-size: 14px; }
    }
    .dialog-body {
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .ref-type-toggle {
      display: flex;
      gap: 4px;
      
      button {
        flex: 1;
        padding: 8px 12px;
        font-size: 13px;
        font-weight: 500;
        border: 1px solid var(--border-subtle);
        background: var(--bg-card);
        color: var(--text-secondary);
        border-radius: 6px;
        transition: all 0.2s ease;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        
        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }
        
        &:hover:not(.active) {
          background: var(--bg-secondary);
          border-color: var(--accent-cyan);
        }
        
        &.active {
          background: var(--accent-cyan);
          color: white;
          border-color: var(--accent-cyan);
          font-weight: 600;
        }
      }
    }
    .search-field { width: 100%; }
    .results-container {
      height: 300px;
      overflow-y: auto;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: rgba(0,0,0,0.1);
      position: relative;
      display: flex;
      flex-direction: column;
    }
    mat-spinner { margin: 24px auto; }
    .loading-more {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 12px; color: var(--text-muted); font-size: 13px;
    }
    .no-results {
      padding: 32px; text-align: center; color: var(--text-muted);
    }
    .commit-hash {
      font-family: monospace; font-size: 12px; color: var(--text-muted);
    }
    .ref-item {
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .ref-title {
      font-size: 15px;
      font-weight: 500;
      color: #00d2ff;
      letter-spacing: 0.5px;
    }
    mat-action-list button {
      transition: background 0.2s;
      &.selected {
        background: rgba(0, 210, 255, 0.15);
        border-left: 3px solid #00d2ff;
      }
      &:hover:not(.selected) {
        background: rgba(255,255,255,0.05);
      }
    }
    .dialog-footer {
      padding: 12px 24px;
      display: flex; justify-content: flex-end;
      border-top: 1px solid var(--border-color);
    }
  `]
})
export class VersionSelectDialogComponent implements OnInit {
  refType = signal<'branch' | 'tag'>('branch');
  searchText = signal('');
  options = signal<any[]>([]);
  loading = signal(false);
  
  // Store the latest tag for the branch selection prompt
  latestTag = signal<any>(null);
  
  start = signal(0);
  hasMore = signal(true);
  
  private searchSubject = new Subject<string>();

  constructor(
    public dialogRef: MatDialogRef<VersionSelectDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VersionSelectDialogData,
    private bitbucket: BitbucketService
  ) {
    this.searchSubject.pipe(
      takeUntilDestroyed(),
      debounceTime(400),
      distinctUntilChanged()
    ).subscribe(() => {
      this.start.set(0);
      this.hasMore.set(true);
      this.loadData(false);
    });
  }

  ngOnInit() {
    // Fetch latest tag just for the prompt feature
    this.bitbucket.getTags(this.data.repository, this.data.project, '', 0, 1).subscribe(res => {
      if (res.values && res.values.length > 0) {
        this.latestTag.set(res.values[0]);
      }
    });

    // Initial load
    this.loadData(false);
  }

  onTypeChange(type: 'branch' | 'tag') {
    this.refType.set(type);
    this.searchText.set('');
    this.start.set(0);
    this.hasMore.set(true);
    this.options.set([]);
    this.loadData(false);
  }

  onSearchChange(text: string) {
    this.searchText.set(text);
    this.searchSubject.next(text);
  }

  onScroll(event: Event) {
    const target = event.target as HTMLElement;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 50) {
      if (this.hasMore() && !this.loading()) {
        this.loadData(true);
      }
    }
  }

  private loadData(append: boolean = false) {
    this.loading.set(true);
    const type = this.refType();
    const obs: Observable<any> = type === 'branch'
      ? this.bitbucket.getBranches(this.data.repository, this.data.project, this.searchText(), this.start(), 20)
      : this.bitbucket.getTags(this.data.repository, this.data.project, this.searchText(), this.start(), 20);

    obs.subscribe({
      next: (res: any) => {
        const newItems = res.values || [];
        if (append) {
          this.options.set([...this.options(), ...newItems]);
        } else {
          this.options.set(newItems);
        }
        this.hasMore.set(!res.isLastPage);
        this.start.set(res.nextPageStart || 0);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  selectRef(refId: string) {
    // If selecting a branch, also show the latest tag info
    const tag = this.latestTag();
    if (this.refType() === 'branch' && tag) {
      const tagName = tag.displayId || tag.name;
      
      // Ask user if they want to use the branch or the latest tag
      if (confirm(`You selected branch "${refId}".\n\nWould you like to use the latest tag "${tagName}" instead?\n\nClick OK for Tag, Cancel for Branch.`)) {
        this.dialogRef.close(tagName);
        return;
      }
    }
    this.dialogRef.close(refId);
  }

  close() {
    this.dialogRef.close();
  }
}
