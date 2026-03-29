import { Injectable, signal } from '@angular/core';

export type WorkspaceDomain = 'work' | 'personal' | null;

export interface UserSession {
  username: string;
  domain: WorkspaceDomain;
}

@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private _session = signal<UserSession>({ username: '', domain: null });
  session = this._session.asReadonly();

  constructor() {
    this.restore();
  }

  restore() {
    try {
      const raw = localStorage.getItem('dev_helper_session');
      if (raw) {
        this._session.set(JSON.parse(raw));
      }
    } catch {}
  }

  login(username: string, domain: WorkspaceDomain) {
    const s = { username: username.trim(), domain };
    this._session.set(s);
    localStorage.setItem('dev_helper_session', JSON.stringify(s));
  }

  logout() {
    this._session.set({ username: '', domain: null });
    localStorage.removeItem('dev_helper_session');
  }

  isLoggedIn(): boolean {
    const s = this._session();
    return !!(s.username && s.domain);
  }
}
