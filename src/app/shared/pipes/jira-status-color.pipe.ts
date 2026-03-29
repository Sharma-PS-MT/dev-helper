import { Pipe, PipeTransform } from '@angular/core';
import { JiraStatus, JiraTicket, resolveStatusCategory } from '../../core/models/jira.models';

@Pipe({
  name: 'jiraStatusColor',
  standalone: true,
})
export class JiraStatusColorPipe implements PipeTransform {
  transform(ticketOrCategory: JiraTicket | string): string {
    if (typeof ticketOrCategory === 'string') {
      return ticketOrCategory; // fallback if already category (done/progress/todo etc)
    }
    return resolveStatusCategory(ticketOrCategory);
  }
}
