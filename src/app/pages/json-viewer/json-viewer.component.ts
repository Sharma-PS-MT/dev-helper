import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NotificationService } from '../../core/services/notification.service';
import { JSONPath } from 'jsonpath-plus';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { TemplateRef, ViewChild } from '@angular/core';

@Component({
  selector: 'app-json-viewer',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatTooltipModule,
    MatSelectModule, MatOptionModule, MatAutocompleteModule,
    MatMenuModule, MatDialogModule
  ],
  templateUrl: './json-viewer.component.html',
  styleUrls: ['./json-viewer.component.scss']
})
export class JsonViewerComponent {
  rawJson = signal<string>('');
  parsedObj = signal<any>(null);
  isValid = signal<boolean>(true);
  errorMsg = signal<string>('');
  
  // Highlighted HTML output safely typed for strict parsing
  highlightedHtml = signal<SafeHtml>('');

  // Query & Analysis
  queryInput = signal<string>('');
  queryType = signal<'jsonpath' | 'regex'>('jsonpath');
  calculationType = signal<'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'>('sum');
  queryResult = signal<any>(null);
  calculationResult = signal<string | number | null>(null);
  queryError = signal<string>('');
  isFooterExpanded = signal<boolean>(false);

  // Suggestions
  suggestions = signal<{display: string, value: string}[]>([]);
  /** Maps a normalised path-segment string to the keys available at that level. */
  pathIndex = signal<Map<string, Set<string>>>(new Map());

  // Statistics
  itemCount = computed(() => {
    const obj = this.parsedObj();
    if (obj === null || obj === undefined) return 0;
    if (Array.isArray(obj)) return obj.length;
    if (typeof obj === 'object') return Object.keys(obj).length;
    return 1;
  });

  dataType = computed(() => {
    const obj = this.parsedObj();
    if (obj === null) return 'Empty';
    if (Array.isArray(obj)) return 'Array';
    return typeof obj === 'object' ? 'Object' : typeof obj;
  });

  @ViewChild('helpDialog') helpDialogTpl!: TemplateRef<any>;

  constructor(
    private sanitizer: DomSanitizer,
    private notify: NotificationService,
    private dialog: MatDialog
  ) {}

  onPaste(event: ClipboardEvent) {
    setTimeout(() => this.formatJson(), 10);
  }

  onInputChange(val: string) {
    if (!val.trim()) {
      this.clear();
      return;
    }
    try {
      const parsed = JSON.parse(val);
      this.parsedObj.set(parsed);
      this.isValid.set(true);
      this.errorMsg.set('');
      this.generateHighlightedHtml(val);
      this.extractKeys(parsed); // Build keys for autocomplete
      this.applyQuery(); // Trigger query update
    } catch (e: any) {
      this.isValid.set(false);
      this.parsedObj.set(null);
      this.errorMsg.set(e.message || 'Invalid JSON format');
      this.generateHighlightedHtml(val);
      this.queryResult.set(null); // Clear query result
    }
  }

  applyQuery() {
    const obj = this.parsedObj();
    const query = this.queryInput().trim();
    const type = this.queryType();

    if (!obj || !query) {
      this.queryResult.set(null);
      this.queryError.set('');
      this.applyCalculation();
      this.updateSuggestions('');
      return;
    }

    try {
      this.queryError.set('');
      if (type === 'jsonpath') {
        const normalizedQuery = this.normalizeJsonPath(query);
        const result = JSONPath({ path: normalizedQuery, json: obj });
        this.queryResult.set(result);
      } else {
        // Regex search
        const regex = new RegExp(query, 'i');
        const results: any[] = [];
        
        const search = (item: any) => {
          if (typeof item === 'string' && regex.test(item)) {
            results.push(item);
          } else if (Array.isArray(item)) {
            item.forEach(search);
          } else if (typeof item === 'object' && item !== null) {
            Object.values(item).forEach(search);
          }
        };
        
        search(obj);
        this.queryResult.set(results);
      }
      this.applyCalculation();
      this.updateSuggestions(query);
    } catch (e: any) {
      this.queryError.set(e.message || 'Query Error');
      this.queryResult.set(null);
      this.calculationResult.set(null);
    }
  }



  updateSuggestions(query: string) {
    if (this.queryType() !== 'jsonpath') {
      this.suggestions.set([]);
      return;
    }

    // When the input is completely empty, just suggest the root starter
    if (!query.trim()) {
      this.suggestions.set([{ display: '$.', value: '$.' }]);
      return;
    }

    const index = this.pathIndex();
    if (index.size === 0) { this.suggestions.set([]); return; }

    // Determine whether the user just finished a segment (ends with . or [)
    // or is mid-typing a key token.
    const endsWithSep = /[.\[]$/.test(query);
    const contextPath = endsWithSep ? query : query.replace(/[^.\[]*$/, '');
    // Partial token being typed (empty when cursor is right after a separator)
    const partial = endsWithSep ? '' : (query.match(/[^.\[\]"']*$/) ?? [''])[0];

    // Normalise the context path to a lookup key used in pathIndex:
    // Strip leading $ and any trailing . or [, collapse [*] / [0-9] into [*]
    const normKey = this.normalisePathKey(contextPath);

    const keysAtLevel = index.get(normKey);
    if (!keysAtLevel || keysAtLevel.size === 0) {
      this.suggestions.set([]);
      return;
    }

    const filtered = Array.from(keysAtLevel)
      .filter(k => !partial || k.toLowerCase().startsWith(partial.toLowerCase()))
      .slice(0, 5)
      .map(k => {
        let fullPath = '';
        if (contextPath.endsWith('.')) {
          fullPath = contextPath + k;
        } else if (contextPath.endsWith('[')) {
          // If the user typed '[', then they are probably typing a property inside brackets.
          // Wait, 'k' can be '[*]' which already has brackets.
          if (k.startsWith('[')) {
            // e.g. contextPath = '$.', but k is '[*]'
            fullPath = contextPath + k;
          } else {
            fullPath = contextPath + k + (k.endsWith(']') ? '' : ']');
          }
        } else {
          // It's the root (e.g., user typed nothing or just $ and we didn't match endsWithSep)
          if (k.startsWith('[')) fullPath = contextPath + k;
          else fullPath = contextPath + (contextPath ? '.' : '') + k;
        }
        
        // Clean up any double dots or brackets
        fullPath = fullPath.replace(/\.\./g, '.').replace(/\[\[/g, '[').replace(/\]\]/g, ']');
        
        // Auto-append dot if it has children (i.e. if it's an object/array)
        const norm = this.normalisePathKey(fullPath);
        if (index.has(norm)) {
          fullPath += '.';
        }
        
        return { display: k, value: fullPath };
      });

    this.suggestions.set(filtered);
  }

  /** Normalise a partial JSONPath into an index lookup key. */
  private normalisePathKey(path: string): string {
    let p = path
      .replace(/\[\d+\]/g, '[*]')   // collapse numeric indices
      .replace(/\.$/, '')           // trailing dot
      .replace(/\[$/, '')           // trailing open bracket
      .replace(/\.\./g, '.**.')     // recursive descent marker
      .replace(/\.\[/g, '[');       // collapse optional dot before array bracket
    
    if (!p) return '$';
    if (!p.startsWith('$')) p = '$' + (p.startsWith('.') ? p : '.' + p);
    
    // Clean up double dots or $. at start
    p = p.replace(/^\$\./, '$');
    if (p === '') return '$';
    return p;
  }

  extractKeys(obj: any) {
    const index = new Map<string, Set<string>>();

    const addKey = (pathKey: string, key: string) => {
      if (!index.has(pathKey)) index.set(pathKey, new Set());
      index.get(pathKey)!.add(key);
    };

    const walk = (item: any, pathKey: string) => {
      if (Array.isArray(item)) {
        addKey(pathKey, '[*]');
        if (item.length > 0) {
          walk(item[0], pathKey + '[*]');
        }
      } else if (typeof item === 'object' && item !== null) {
        Object.keys(item).forEach(k => {
          addKey(pathKey, k);
          walk(item[k], pathKey + (pathKey === '$' ? '' : '.') + k);
        });
      }
    };

    walk(obj, '$');
    this.pathIndex.set(index);
  }

  applyCalculation() {
    const data = this.queryResult();
    const type = this.calculationType();

    if (data === null || type === 'none') {
      this.calculationResult.set(null);
      return;
    }

    // Ensure we have a flat array of numbers for calculations
    const items = Array.isArray(data) ? data.flat(Infinity) : [data];
    const numericItems = items
      .map(item => (typeof item === 'number' ? item : parseFloat(item)))
      .filter(item => !isNaN(item));

    switch (type) {
      case 'count':
        this.calculationResult.set(items.length);
        break;
      case 'sum':
        this.calculationResult.set(numericItems.reduce((a, b) => a + b, 0));
        break;
      case 'avg':
        this.calculationResult.set(numericItems.length > 0 ? (numericItems.reduce((a, b) => a + b, 0) / numericItems.length).toFixed(2) : 0);
        break;
      case 'min':
        this.calculationResult.set(numericItems.length > 0 ? Math.min(...numericItems) : null);
        break;
      case 'max':
        this.calculationResult.set(numericItems.length > 0 ? Math.max(...numericItems) : null);
        break;
      default:
        this.calculationResult.set(null);
    }
  }

  onQueryChange() {
    this.applyQuery();
  }

  /**
   * Normalize a JSONPath query to work around the jsonpath-plus limitation
   * where quoted union keys (e.g., ['key1','key2']) return empty results.
   * Simple identifier keys are unquoted: ['a','b'] → [a,b]
   * Quoted keys that are not simple identifiers (e.g., contain spaces) are left as-is.
   */
  private normalizeJsonPath(path: string): string {
    // Match bracket expressions like ['key1','key2'] or ["key1","key2"] with 2+ items
    return path.replace(/\[([^\]]+)\]/g, (match, inner) => {
      // Split by comma, handling optional spaces around commas
      const parts = inner.split(',').map((p: string) => p.trim());

      // Check if all parts are quoted simple identifiers
      const isQuotedUnion = parts.length > 1 && parts.every((p: string) =>
        /^['"][a-zA-Z_$][a-zA-Z0-9_$]*['"]$/.test(p)
      );

      if (isQuotedUnion) {
        // Strip the quotes from each key
        const unquoted = parts.map((p: string) => p.slice(1, -1)).join(',');
        return `[${unquoted}]`;
      }

      return match;
    });
  }

  onSuggestionSelect(suggestion: string) {
    const current = this.queryInput();
    const parts = current.split(/[.\[\]]/);
    
    // Find where the last part starts
    const lastPart = parts[parts.length - 1];
    const prefix = current.substring(0, current.lastIndexOf(lastPart));
    
    const updated = prefix + suggestion;
    this.queryInput.set(updated);
    this.applyQuery();
  }

  toggleFooter() {
    this.isFooterExpanded.set(!this.isFooterExpanded());
  }

  formatJson() {
    const input = this.rawJson().trim();
    if (!input) {
      this.clear();
      return;
    }

    try {
      const parsed = JSON.parse(input);
      this.parsedObj.set(parsed);
      this.isValid.set(true);
      this.errorMsg.set('');

      const beautified = JSON.stringify(parsed, null, 2);
      this.rawJson.set(beautified);
      this.generateHighlightedHtml(beautified);
      this.applyQuery();
      
    } catch (e: any) {
      this.isValid.set(false);
      this.parsedObj.set(null);
      this.errorMsg.set(e.message || 'Invalid JSON format');
      this.highlightedHtml.set('');
      this.queryResult.set(null);
    }
  }

  generateHighlightedHtml(jsonString: string) {
    const obj = this.parsedObj();
    if (obj !== null) {
      const html = this.buildSyntaxHighlightedHtml(obj);
      this.highlightedHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
      return;
    }

    // Escape HTML characters to prevent XSS manually before coloring (Fallback for Invalid JSON)
    const escaped = jsonString
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Regex syntax highlighter logic
    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
    
    const highlighted = escaped.replace(regex, (match) => {
      let cls = 'number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'key';
        } else {
          cls = 'string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'boolean';
      } else if (/null/.test(match)) {
        cls = 'null';
      }
      return `<span class="${cls}">${match}</span>`;
    });

    this.highlightedHtml.set(this.sanitizer.bypassSecurityTrustHtml(highlighted));
  }

  onCodeClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target.classList.contains('json-toggle')) {
      const block = target.closest('.json-block');
      if (block) {
        block.classList.toggle('collapsed');
      }
    }
  }

  private buildSyntaxHighlightedHtml(obj: any, indentLevel = 0, isLast = true): string {
    const indent = '  '.repeat(indentLevel);
    const innerIndent = '  '.repeat(indentLevel + 1);
    
    if (obj === null) return `<span class="null">null</span>${isLast ? '' : ','}`;
    if (typeof obj === 'boolean') return `<span class="boolean">${obj}</span>${isLast ? '' : ','}`;
    if (typeof obj === 'number') return `<span class="number">${obj}</span>${isLast ? '' : ','}`;
    if (typeof obj === 'string') {
      const escaped = obj.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span class="string">"${escaped}"</span>${isLast ? '' : ','}`;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return `[]${isLast ? '' : ','}`;
      const countLabel = `<span class="text-muted text-sm" style="opacity: 0.7; font-style: italic;"> // ${obj.length} item${obj.length === 1 ? '' : 's'}</span>`;
      let html = `<span class="json-block"><span class="json-toggle">▼</span>[ ${countLabel}<span class="json-content">\n`;
      for (let i = 0; i < obj.length; i++) {
        html += innerIndent + this.buildSyntaxHighlightedHtml(obj[i], indentLevel + 1, i === obj.length - 1) + '\n';
      }
      html += indent + `</span><span class="json-close-bracket">]</span></span>${isLast ? '' : ','}`;
      return html;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) return `{}${isLast ? '' : ','}`;
      const countLabel = `<span class="text-muted text-sm" style="opacity: 0.7; font-style: italic;"> // ${keys.length} key${keys.length === 1 ? '' : 's'}</span>`;
      let html = `<span class="json-block"><span class="json-toggle">▼</span>{ ${countLabel}<span class="json-content">\n`;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = obj[key];
        const isLastKey = i === keys.length - 1;
        const escapedKey = key.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html += innerIndent + `<span class="key">"${escapedKey}"</span>: ` + this.buildSyntaxHighlightedHtml(val, indentLevel + 1, isLastKey) + '\n';
      }
      html += indent + `</span><span class="json-close-bracket">}</span></span>${isLast ? '' : ','}`;
      return html;
    }

    return '';
  }

  minifyJson() {
    if (this.parsedObj() !== null && this.isValid()) {
      const minified = JSON.stringify(this.parsedObj());
      this.rawJson.set(minified);
      this.generateHighlightedHtml(minified);
    } else {
      this.formatJson();
      if (this.isValid()) {
        const minified = JSON.stringify(this.parsedObj());
        this.rawJson.set(minified);
        this.generateHighlightedHtml(minified);
      }
    }
  }

  clear() {
    this.rawJson.set('');
    this.parsedObj.set(null);
    this.highlightedHtml.set('');
    this.isValid.set(true);
    this.errorMsg.set('');
    this.queryInput.set('');
    this.queryResult.set(null);
    this.calculationResult.set(null);
    this.queryError.set('');
    this.pathIndex.set(new Map());
    this.suggestions.set([]);
  }

  async copyQueryResult() {
    const result = this.queryResult();
    if (result === null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      this.notify.success('Query results copied to clipboard.');
    } catch {
      this.notify.error('Failed to copy. Your browser might block this without HTTPS.');
    }
  }

  async copyToClipboard() {
    const text = this.rawJson();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.notify.success('Copied! The JSON data is in your clipboard.');
    } catch (e) {
      this.notify.error('Failed to copy. Your browser might block this action without HTTPS.');
    }
  }

  openHelpDialog() {
    this.dialog.open(this.helpDialogTpl, {
      width: '600px',
      panelClass: 'premium-dialog'
    });
  }
}
