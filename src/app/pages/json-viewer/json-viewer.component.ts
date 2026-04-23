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

@Component({
  selector: 'app-json-viewer',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    MatCardModule, MatFormFieldModule, MatInputModule,
    MatButtonModule, MatIconModule, MatTooltipModule,
    MatSelectModule, MatOptionModule
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
  calculationType = signal<'none' | 'sum' | 'avg' | 'count' | 'min' | 'max'>('none');
  queryResult = signal<any>(null);
  calculationResult = signal<string | number | null>(null);
  queryError = signal<string>('');
  isFooterExpanded = signal<boolean>(true);

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

  constructor(
    private sanitizer: DomSanitizer,
    private notify: NotificationService
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
      return;
    }

    try {
      this.queryError.set('');
      if (type === 'jsonpath') {
        const result = JSONPath({ path: query, json: obj });
        this.queryResult.set(result);
      } else {
        // Regex search on the stringified JSON or structured?
        // Usually regex on JSON means searching values or keys.
        // We'll treat it as a filter on string values if it's an array, or just string match.
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
    } catch (e: any) {
      this.queryError.set(e.message || 'Query Error');
      this.queryResult.set(null);
      this.calculationResult.set(null);
    }
  }

  applyCalculation() {
    const data = this.queryResult();
    const type = this.calculationType();

    if (data === null || type === 'none') {
      this.calculationResult.set(null);
      return;
    }

    // Ensure we have an array for calculations
    const items = Array.isArray(data) ? data : [data];
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
}
