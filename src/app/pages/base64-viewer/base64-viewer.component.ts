import { Component, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-base64-viewer',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule,
    MatFormFieldModule, MatInputModule, MatButtonModule,
    MatIconModule, MatTooltipModule
  ],
  templateUrl: './base64-viewer.component.html',
  styleUrls: ['./base64-viewer.component.scss']
})
export class Base64ViewerComponent {
  base64Input = '';
  imageSrc = signal<string | null>(null);
  errorMsg = signal<string | null>(null);

  @ViewChild('previewImg') previewImg?: ElementRef<HTMLImageElement>;

  onInputChange(val: string) {
    this.processBase64(val);
  }

  onPaste(event: ClipboardEvent) {
    setTimeout(() => this.processBase64(this.base64Input), 10);
  }

  clear() {
    this.base64Input = '';
    this.imageSrc.set(null);
    this.errorMsg.set(null);
  }

  processBase64(val: string) {
    if (!val || !val.trim()) {
      this.imageSrc.set(null);
      this.errorMsg.set(null);
      return;
    }

    let cleaned = val.trim();
    
    // Remove surrounding double quotes if they exist
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }
    // Remove surrounding single quotes just in case
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
      cleaned = cleaned.substring(1, cleaned.length - 1);
    }

    // Add data URI prefix if it's lacking one and looks like raw base64
    if (!cleaned.startsWith('data:image')) {
      // Very basic check if it is potentially base64 logic
      cleaned = 'data:image/png;base64,' + cleaned;
    }

    this.imageSrc.set(cleaned);
    this.errorMsg.set(null);
  }

  toggleFullScreen() {
    const imgElement = this.previewImg?.nativeElement;
    if (!imgElement) return;

    if (!document.fullscreenElement) {
      if (imgElement.requestFullscreen) {
        imgElement.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }
}
