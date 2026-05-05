import { JiraTicket } from './jira.models';

export interface BitbucketProject {
  key: string;
  name: string;
  type: string;
  description?: string;
}

export interface BitbucketRepo {
  slug: string;
  name: string;
  full_name: string;
  description?: string;
  mainbranch?: { name: string };
}

export interface BitbucketPR {
  id: number;
  title: string;
  description?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED';
  author: { display_name: string; uuid: string };
  created_on: string;
  updated_on: string;
  source: { branch: { name: string }; repository: { full_name: string } };
  destination: { branch: { name: string } };
  reviewers: Array<{ display_name: string; role?: string }>;
  participants: Array<{ display_name: string; approved?: boolean; role?: string }>;
  comment_count: number;
  task_count: number;
  links: { html: { href: string } };
}

export interface BitbucketCommit {
  hash: string;
  message: string;
  author: { raw: string; user?: { display_name: string } };
  date: string;
  parents?: Array<{ hash: string }>;
  ticketIds?: string[];
}

export interface BitbucketBranch {
  name: string;
  target: { hash: string; date: string };
}

export interface BitbucketTag {
  name: string;
  target?: { hash: string; date: string };
  date?: string;
}

export interface BitbucketDiff {
  diffs: Array<{
    old?: { path: string };
    new?: { path: string };
    type: string;
    lines_added: number;
    lines_removed: number;
  }>;
}

export interface PRAnalysis {
  pr: BitbucketPR;
  commits: BitbucketCommit[];
  ticketIds: string[];
  missingTicketCommits: BitbucketCommit[];
  gaps: PRGap[];
  tickets: JiraTicket[];
  diffStats?: { additions: number; deletions: number; filesChanged: number };
}

export interface PRGap {
  type: 'missing-ticket' | 'open-ticket' | 'not-linked' | 'pr-open' | 'no-reviewers';
  severity: 'error' | 'warn' | 'info';
  message: string;
  detail?: string;
  ticketId?: string;
}

export interface BranchComparison {
  fromRef: string;
  toRef: string;
  commits: CommitWithTickets[];
  ticketSummary: TicketSummary;
}

export interface CommitWithTickets {
  commit: BitbucketCommit;
  ticketIds: string[];
  tickets: JiraTicket[];
}

export interface TicketSummary {
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  blocked: number;
  other: number;
}

export interface BranchGapAnalysis {
  fromRef: string;
  toRef: string;
  /** Commits in fromRef that are NOT in toRef — CRITICAL (forward only) */
  criticalCommits: CommitWithTickets[];
  /** Commits in toRef that are NOT in fromRef — INCOMING (reverse only) */
  incomingCommits: CommitWithTickets[];
  /** Raw total commits fetched from→to before dedup */
  totalForward: number;
  /** Raw total commits fetched to→from before dedup */
  totalReverse: number;
}
