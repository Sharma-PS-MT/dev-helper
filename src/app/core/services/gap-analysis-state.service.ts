import { Injectable, signal } from '@angular/core';

export interface GapServiceState {
  appName: string;
  repository: string;
  project: string;
  sourceVersion: string;
  targetVersion: string;
}

export interface GapAnalysisState {
  sourceEnv: string;
  targetEnv: string;
  services: GapServiceState[];
}

@Injectable({ providedIn: 'root' })
export class GapAnalysisStateService {
  private _state = signal<GapAnalysisState | null>(null);
  readonly state = this._state.asReadonly();

  set(state: GapAnalysisState) {
    this._state.set(state);
  }

  consume(): GapAnalysisState | null {
    const val = this._state();
    this._state.set(null);
    return val;
  }
}
