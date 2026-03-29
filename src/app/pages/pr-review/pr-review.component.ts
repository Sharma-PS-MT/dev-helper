import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { BitbucketService } from '../../core/services/bitbucket.service';
import { NotificationService } from '../../core/services/notification.service';
import { BitbucketProject, BitbucketRepo, PRAnalysis, BitbucketPR } from '../../core/models/bitbucket.models';
import { TicketBadgeComponent } from '../../shared/components/ticket-badge/ticket-badge.component';
import { GeminiService } from '../../core/services/gemini.service';

@Component({
  selector: 'app-pr-review',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatFormFieldModule,
    MatSelectModule, MatInputModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatProgressSpinnerModule, MatPaginatorModule, TicketBadgeComponent,
  ],
  templateUrl: './pr-review.component.html',
  styleUrls: ['./pr-review.component.scss'],
})
export class PrReviewComponent implements OnInit {
  projects = signal<BitbucketProject[]>([]);
  repos = signal<BitbucketRepo[]>([]);

  selectedProject = signal<string | null>(null);
  selectedRepo = signal<string | null>(null);
  prInput = signal<string>('');

  projectSearch = signal('');
  repoSearch = signal('');

  filteredProjects = computed(() => {
    const t = this.projectSearch().toLowerCase();
    return this.projects().filter(p => (p.name || '').toLowerCase().includes(t) || (p.key || '').toLowerCase().includes(t));
  });

  filteredRepos = computed(() => {
    const t = this.repoSearch().toLowerCase();
    return this.repos().filter(r => (r.name || '').toLowerCase().includes(t) || (r.slug || '').toLowerCase().includes(t));
  });

  loadingProjects = signal(false);
  loadingRepos = signal(false);
  analyzing = signal(false);

  openPRs = signal<BitbucketPR[]>([]);
  loadingPRs = signal(false);

  aiReviewing = signal(false);
  aiReviewResult = signal<string | null>(null);

  result = signal<PRAnalysis | null>(null);

  pageSize = signal(50);
  pageIndex = signal(0);

  paginatedCommits = computed(() => {
    const res = this.result();
    if (!res) return [];
    const start = this.pageIndex() * this.pageSize();
    return res.commits.slice(start, start + this.pageSize());
  });

  constructor(
    private bitbucket: BitbucketService,
    private notify: NotificationService,
    private gemini: GeminiService,
  ) {}

  ngOnInit(): void {
    this.loadProjects();
  }

  loadProjects(): void {
    this.loadingProjects.set(true);
    this.bitbucket.getProjects().subscribe({
      next: px => { this.projects.set(px); this.loadingProjects.set(false); },
      error: () => { this.notify.error('Failed to load projects'); this.loadingProjects.set(false); }
    });
  }

  onProjectChange(key: string): void {
    this.selectedProject.set(key);
    this.selectedRepo.set(null);
    this.openPRs.set([]);
    this.loadingRepos.set(true);
    this.bitbucket.getRepositories(key).subscribe({
      next: rx => { this.repos.set(rx); this.loadingRepos.set(false); },
      error: () => { this.notify.error('Failed to load repos'); this.loadingRepos.set(false); }
    });
  }

  onRepoChange(slug: string): void {
    this.selectedRepo.set(slug);
    this.loadingPRs.set(true);
    this.openPRs.set([]);
    
    const proj = this.selectedProject() || undefined;
    this.bitbucket.getOpenPullRequests(slug, proj).subscribe({
      next: prs => {
        this.openPRs.set(prs);
        this.loadingPRs.set(false);
      },
      error: () => this.loadingPRs.set(false)
    });
  }

  selectAndAnalyzePR(prId: number): void {
    this.prInput.set(prId.toString());
    this.analyze();
  }

  initiateAIReview(): void {
    const data = this.result();
    if (!data) return;

    this.aiReviewing.set(true);
    this.aiReviewResult.set(null);

    let prompt = `You are a Senior Technical Reviewer. I need a code review analysis on the following Pull Request context.\n\n`;
    prompt += `**PR Title:** ${data.pr.title}\n`;
    prompt += `**PR Description:** ${data.pr.description || 'None'}\n\n`;
    
    prompt += `**Gap Analysis Detected by System:**\n`;
    if (data.gaps.length === 0) {
      prompt += `- No gaps found.\n`;
    } else {
      data.gaps.forEach(g => prompt += `- [${g.severity.toUpperCase()}] ${g.message} (${g.detail || ''})\n`);
    }

    prompt += `\n**Commits:**\n`;
    data.commits.forEach(c => {
      prompt += `- Hash: ${c.hash.substring(0, 7)}, Msg: ${c.message.split('\n')[0]}\n`;
    });

    prompt += `\nPlease provide a concise, high-level structural review identifying potential risks based on these commit messages and gaps. Do not write filler text. Output cleanly using markdown.`;

    this.gemini.generateCodeReview(prompt).subscribe({
      next: (text) => {
        this.aiReviewResult.set(text);
        this.aiReviewing.set(false);
      },
      error: (err) => {
        console.error(err);
        this.notify.error(err.message || 'Failed to communicate with Gemini API. Check your settings.');
        this.aiReviewing.set(false);
      }
    });
  }

  analyze(): void {
    let repoSlug = this.selectedRepo();
    let prId: number | null = null;
    const input = this.prInput().trim();

    if (!input) return;

    let projKey = this.selectedProject() || undefined;

    // Try parsing as URL
    const parsed = this.bitbucket.parsePRUrl(input);
    if (parsed) {
      projKey = parsed.projectKey;
      repoSlug = parsed.repoSlug;
      prId = parsed.prId;
      // auto-select project & repo if exists in current lists
      if (!this.selectedProject() && this.projects().some(p => p.key === projKey)) {
        this.selectedProject.set(projKey);
      }
      if (!this.selectedRepo() && this.repos().some(r => r.slug === repoSlug)) {
        this.selectedRepo.set(repoSlug);
      }
    } else if (/^\d+$/.test(input) && repoSlug) {
      prId = parseInt(input, 10);
    } else {
      this.notify.error('Please select a repository and enter a valid PR ID, or paste a full PR URL.');
      return;
    }

    if (!repoSlug || !prId) return;

    this.analyzing.set(true);
    this.result.set(null);

    this.bitbucket.analyzePR(repoSlug, prId, projKey).subscribe({
      next: res => {
        this.result.set(res);
        this.analyzing.set(false);
        if (res.gaps.length === 0) this.notify.success('All clear! No gaps found.');
        else this.notify.warn(`Found ${res.gaps.length} potential gaps/issues.`);
      },
      error: err => {
        this.analyzing.set(false);
        this.notify.error('Failed to analyze PR. Check URL/ID or permissions.');
        console.error(err);
      }
    });
  }

  clear(): void {
    this.selectedProject.set(null);
    this.selectedRepo.set(null);
    this.prInput.set('');
    this.result.set(null);
    this.openPRs.set([]);
    this.pageIndex.set(0);
  }

  onPageChange(e: PageEvent): void {
    this.pageSize.set(e.pageSize);
    this.pageIndex.set(e.pageIndex);
  }

  getTicket(id: string) {
    return this.result()?.tickets.find((t: any) => t.key === id);
  }

  getMissingTicketCommits() {
    return this.result()?.missingTicketCommits || [];
  }
}
