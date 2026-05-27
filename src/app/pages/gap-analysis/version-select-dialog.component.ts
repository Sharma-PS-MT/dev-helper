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
import { Subject, Observable } from 'rxjs';
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
        <mat-form-field appearance="outline" class="search-field">
          <mat-label>Search Tags</mat-label>
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
                    (click)="selectRef(opt.displayId)"
                    [class.selected]="opt.displayId === data.currentVersion"
                    class="tag-item">
              <mat-icon matListItemIcon>local_offer</mat-icon>
              <span matListItemTitle class="tag-title">{{ opt.displayId }}</span>
              <span matListItemLine class="commit-hash">{{ opt.latestCommit?.substring(0,8) }}</span>
            </button>
          </mat-action-list>

          <div *ngIf="loading() && options().length > 0" class="loading-more">
            <mat-spinner diameter="24"></mat-spinner>
            <span>Loading more...</span>
          </div>

          <div *ngIf="!loading() && options().length === 0" class="no-results">
            No tags found matching "{{ searchText() }}"
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
    .tag-item {
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .tag-title {
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
  searchText = signal('');
  options = signal<any[]>([]);
  loading = signal(false);
  
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
      distinctUntilChanged(),
      tap(() => {
        this.start.set(0);
        this.hasMore.set(true);
      }),
      switchMap(text => this.loadRefs(false, text))
    ).subscribe();
  }

  ngOnInit() {
    // Initial load
    this.loadRefs(false, '').subscribe();
  }

  onSearchChange(text: string) {
    this.searchText.set(text);
    this.searchSubject.next(text);
  }

  onScroll(event: any) {
    const target = event.target;
    if (target.scrollHeight - target.scrollTop <= target.clientHeight + 20) {
      if (this.hasMore() && !this.loading()) {
        this.loadRefs(true, this.searchText()).subscribe();
      }
    }
  }

  loadRefs(append: boolean = false, filterText: string = ''): Observable<any> {
    this.loading.set(true);
    
    const obs$: Observable<any> = this.bitbucket.getTags(
      this.data.repository, 
      this.data.project, 
      filterText, 
      append ? this.start() : 0
    );

    return obs$.pipe(
      tap((res: any) => {
        const current = append ? this.options() : [];
        this.options.set([...current, ...res.values]);
        this.start.set(res.nextPageStart || 0);
        this.hasMore.set(!res.isLastPage);
        this.loading.set(false);
      })
    );
  }

  selectRef(refId: string) {
    this.dialogRef.close(refId);
  }

  close() {
    this.dialogRef.close();
  }
}
