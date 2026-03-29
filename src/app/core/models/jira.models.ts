export interface JiraTicket {
  id: string;
  key: string;
  summary: string;
  status: JiraStatus;
  priority: JiraPriority;
  assignee?: { displayName: string; emailAddress?: string };
  reporter?: { displayName: string };
  issuetype: { name: string; iconUrl?: string };
  created: string;
  updated: string;
  url?: string;
}

export interface JiraStatus {
  name: string;
  statusCategory: { key: string; colorName: string; name: string };
}

export interface JiraPriority {
  name: string;
  iconUrl?: string;
}

export interface JiraSearchResult {
  total: number;
  issues: JiraIssueRaw[];
}

export interface JiraIssueRaw {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: JiraStatus;
    priority: JiraPriority;
    assignee?: { displayName: string; emailAddress?: string };
    reporter?: { displayName: string };
    issuetype: { name: string; iconUrl?: string };
    created: string;
    updated: string;
  };
}

export type StatusCategory = 'done' | 'progress' | 'todo' | 'blocked' | 'review' | 'other';

export function resolveStatusCategory(ticket: JiraTicket): StatusCategory {
  const type = ticket.issuetype?.name?.toUpperCase() || '';
  const status = ticket.status?.name?.toUpperCase() || '';

  const mappings: Record<string, Record<string, StatusCategory>> = {
    'EPIC': {
      'REJECTED': 'todo',
      'REQUIREMENT GROOMING': 'progress',
      'STORY CREATION': 'progress',
      'REQUIREMENT DOCUMENTATION': 'progress',
      'UNDER TECHNICAL DESIGN': 'review',
      'UNDER ANALYSIS': 'progress',
      'CAB REVIEW': 'review',
      'RELEASED TO UAT': 'done',
      'INTERNAL REQUIREMENT REVIEW': 'progress',
      'CHANGE UNDER CLIENT APPROVAL': 'review',
      'READY FOR IMPLEMENTATION': 'progress',
      'TRIAGE & VALUE MAPPING': 'progress',
      'OBSOLETE STORY': 'other',
      'UAT VALIDATION IN PROGRESS': 'progress',
      'DEVELOPMENT IN PROGRESS': 'progress',
      'UNDER ARB APPROVAL': 'review',
      'UAT VALIDATION FAILED': 'blocked',
      'UI/UX VALIDATION': 'progress',
      'READY FOR RELEASE': 'progress',
      'BACKLOG': 'todo',
      'RELEASED TO PRODUCTION': 'done',
      'SIGNED OFF': 'done',
      'PENDING SME APPROVAL': 'review',
      'UI/UX DESIGN': 'progress',
      'ON HOLD - CS': 'other'
    },
    'STORY': {
      'UAT VALIDATION FAILED': 'blocked',
      'QA IN PROGRESS': 'progress',
      'DONE': 'done',
      'RELEASED TO UAT': 'done',
      'READY FOR RELEASE': 'progress',
      'TECH REVIEW IN PROGRESS': 'review',
      'BACKLOG': 'todo',
      'RELEASED TO PRODUCTION': 'done',
      'QA BLOCKED': 'blocked',
      'QA FAILED': 'blocked',
      'TO DO': 'todo',
      'OBSOLETE STORY': 'other',
      'UAT VALIDATION IN PROGRESS': 'progress',
      'READY FOR QA': 'progress',
      'ON HOLD - CS': 'other',
      'IN PROGRESS': 'progress',
      'READY FOR TECH REVIEW': 'review'
    },
    'SUB-TASK': {
      'TO DO': 'todo',
      'DONE': 'done',
      'IN PROGRESS': 'progress',
      'ON HOLD - CS': 'other'
    },
    'BUG': {
      'QA IN PROGRESS': 'progress',
      'DONE': 'done',
      'RETURNED': 'blocked',
      'TECH REVIEW IN PROGRESS': 'review',
      'REOPEN': 'blocked',
      'BACKLOG': 'todo',
      'QA BLOCKED': 'blocked',
      'QA FAILED': 'blocked',
      'TO DO': 'todo',
      'OBSOLETE STORY': 'other',
      'DEFERRED': 'other',
      'INVALID': 'other',
      'READY FOR QA': 'progress',
      'ON HOLD - CS': 'other',
      'IN PROGRESS': 'progress',
      'READY FOR TECH REVIEW': 'review'
    },
    'TASK': {
      'UAT VALIDATION FAILED': 'blocked',
      'QA IN PROGRESS': 'progress',
      'DONE': 'done',
      'RELEASED TO UAT': 'done',
      'READY FOR RELEASE': 'progress',
      'TECH REVIEW IN PROGRESS': 'review',
      'BACKLOG': 'todo',
      'RELEASED TO PRODUCTION': 'done',
      'QA BLOCKED': 'blocked',
      'QA FAILED': 'blocked',
      'TO DO': 'todo',
      'OBSOLETE STORY': 'other',
      'UAT VALIDATION IN PROGRESS': 'progress',
      'READY FOR QA': 'progress',
      'ON HOLD - CS': 'other',
      'IN PROGRESS': 'progress',
      'READY FOR TECH REVIEW': 'review'
    },
    'STORY BUG': {
      'QA IN PROGRESS': 'progress',
      'DONE': 'done',
      'RETURNED': 'blocked',
      'TECH REVIEW IN PROGRESS': 'review',
      'REOPEN': 'blocked',
      'BACKLOG': 'todo',
      'QA BLOCKED': 'blocked',
      'QA FAILED': 'blocked',
      'TO DO': 'todo',
      'OBSOLETE STORY': 'other',
      'DEFERRED': 'other',
      'INVALID': 'other',
      'READY FOR QA': 'progress',
      'ON HOLD - CS': 'other',
      'IN PROGRESS': 'progress',
      'READY FOR TECH REVIEW': 'review'
    },
    'IMPROVEMENT': {
      'UAT VALIDATION FAILED': 'blocked',
      'QA IN PROGRESS': 'progress',
      'DONE': 'done',
      'RELEASED TO UAT': 'done',
      'READY FOR RELEASE': 'progress',
      'TECH REVIEW IN PROGRESS': 'review',
      'BACKLOG': 'todo',
      'RELEASED TO PRODUCTION': 'done',
      'QA BLOCKED': 'blocked',
      'QA FAILED': 'blocked',
      'TO DO': 'todo',
      'OBSOLETE STORY': 'other',
      'UAT VALIDATION IN PROGRESS': 'progress',
      'READY FOR QA': 'progress',
      'ON HOLD - CS': 'other',
      'IN PROGRESS': 'progress',
      'READY FOR TECH REVIEW': 'review'
    },
    'PRODUCTION BUG': {
      'PENDING RELEASE': 'progress',
      'QA IN PROGRESS': 'progress',
      'VERIFIED BY L2': 'review',
      'DEV IN PROGRESS': 'progress',
      'VERIFIED BY L3': 'review',
      'UAT BLOCKED': 'blocked',
      'QA BLOCKED': 'blocked',
      'QA FAILED': 'blocked',
      'UAT DONE': 'done',
      'TO DO': 'todo',
      'UAT FAILED': 'blocked',
      'UAT IN PROGRESS': 'progress',
      'DEFERRED': 'other',
      'INVALID': 'other',
      'IN PROGRESS': 'progress',
      'READY FOR TECH REVIEW': 'review',
      'CLOSED BY L2': 'done',
      'RETURNED': 'blocked',
      'TECH REVIEW IN PROGRESS': 'review',
      'REOPEN': 'blocked',
      'BACKLOG': 'todo',
      'RELEASED TO PRODUCTION': 'done',
      'READY FOR QA': 'progress',
      'CLOSED BY L3': 'done',
      'ON HOLD - CS': 'other'
    },
    'RELEASE REQUEST': {
      'READY FOR DEPLOYMENT': 'progress',
      'PENDING': 'todo',
      'DEPLOYMENT FAILED': 'blocked',
      'APPROVED': 'done',
      'COMPLETED': 'done',
      'DEPLOYMENT IN PROGRESS': 'progress'
    },
    'USER STORY SUB TASK': {
      'UNDER QA': 'progress',
      'QA COMPLETED': 'progress',
      'DEVELOPMENT REQUIRED FROM OTHER STAKEHOLDERS': 'other',
      'DEV QUEUE': 'progress',
      'READY FOR QA': 'progress',
      'DONE': 'done',
      'ON HOLD': 'other',
      'RESOURCE PLANNING REQUIRED FROM OTHER STAKEHOLDERS': 'other',
      'UNDER DEVELOPEMENT': 'progress',
      'DEV RESOURCE PLANNING': 'review',
      'DROPPED': 'other'
    }
  };

  const typeMap = mappings[type];
  if (typeMap && typeMap[status]) return typeMap[status];

  // Fallback if somehow not specified
  const key = status.toLowerCase();
  if (key.includes('done') || key.includes('resolved') || key.includes('closed')) return 'done';
  if (key.includes('progress') || key.includes('development')) return 'progress';
  if (key.includes('review') || key.includes('testing') || key.includes('qa')) return 'review';
  if (key.includes('block')) return 'blocked';
  return 'todo';
}
