import { Pipe, PipeTransform } from '@angular/core';

/**
 * Filters a unified branch+tag options array by `kind`.
 * Usage: `options | refGroup:'branch'`  or  `options | refGroup:'tag'`
 */
@Pipe({ name: 'refGroup', standalone: true, pure: false })
export class RefGroupPipe implements PipeTransform {
  transform(options: any[], kind: 'branch' | 'tag'): any[] {
    if (!options) return [];
    return options.filter(o => o.kind === kind);
  }
}
