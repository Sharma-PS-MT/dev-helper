import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTooltipModule } from '@angular/material/tooltip';
import { JiraTicket } from '../../../core/models/jira.models';
import { JiraStatusColorPipe } from '../../pipes/jira-status-color.pipe';
import { AuthConfigService } from '../../../core/services/auth-config.service';

@Component({
  selector: 'app-ticket-badge',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, JiraStatusColorPipe],
  template: `
    <a
      *ngIf="ticket"
      [href]="ticketUrl"
      target="_blank"
      class="status-chip"
      [ngClass]="ticket | jiraStatusColor"
      [matTooltip]="ticket.summary"
    >
      <img *ngIf="ticket.issuetype.iconUrl" [src]="ticket.issuetype.iconUrl" class="issue-icon" alt="" />
      <span class="dot" *ngIf="!ticket.issuetype.iconUrl"></span>
      {{ ticket.key }} &middot; {{ ticket.status.name }}
    </a>
    <span *ngIf="!ticket && ticketId" class="status-chip todo">
      <span class="dot"></span>
      {{ ticketId }} (Not Found)
    </span>
  `,
  styles: [`
    a { text-decoration: none; cursor: pointer; transition: filter 0.2s; }
    a:hover { filter: brightness(1.2); }
  `],
})
export class TicketBadgeComponent {
  @Input() ticket?: JiraTicket;
  @Input() ticketId?: string;

  constructor(private authConfig: AuthConfigService) { }

  get ticketUrl(): string {
    if (!this.ticket) return '#';
    return `${this.authConfig.config().jiraBaseUrl}/browse/${this.ticket.key}`;
  }
}
