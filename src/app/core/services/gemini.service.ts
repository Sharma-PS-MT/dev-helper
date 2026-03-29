import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, throwError } from 'rxjs';
import { AuthConfigService } from './auth-config.service';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  constructor(private http: HttpClient, private authConfig: AuthConfigService) {}

  generateCodeReview(prompt: string): Observable<string> {
    const key = this.authConfig.config().geminiApiKey;
    if (!key) {
      return throwError(() => new Error('Gemini API key is not configured in Settings.'));
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    return this.http.post<any>(url, payload).pipe(
      map(res => {
        if (res.candidates && res.candidates.length > 0) {
          return res.candidates[0].content.parts[0].text;
        }
        return 'No response from Gemini API.';
      })
    );
  }
}
