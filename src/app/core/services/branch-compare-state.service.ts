import { Injectable, signal } from '@angular/core';

/**
 * BranchCompareStateService
 * =========================
 * Lightweight signal-based service that carries pre-fill state
 * from the ArgoCD Dashboard → Branch Compare page.
 *
 * The ArgoCD dashboard writes this state, then navigates to /branch-compare.
 * BranchCompareComponent reads + consumes it on ngOnInit.
 */
export interface BranchComparePreFill {
  /** Bitbucket project key  (e.g. "BM") */
  project: string;
  /** Bitbucket repo slug    (e.g. "csi-bm-invoice-java-service") */
  repository: string;
  /**
   * "from" ref — first ArgoCD sync tag (or second app's tag when two apps selected).
   * For a single-app scenario this is the app's sync tag.
   */
  fromRef: string;
  fromType: 'branch' | 'tag';
  /**
   * "to" ref — when two apps are selected this is the second app's sync tag;
   * when one app is selected this is "main".
   */
  toRef: string;
  toType: 'branch' | 'tag';
}

@Injectable({ providedIn: 'root' })
export class BranchCompareStateService {
  /** Filled by ArgoCD dashboard, consumed (and cleared) by BranchCompareComponent */
  private _preFill = signal<BranchComparePreFill[] | null>(null);

  /** Read-only accessor */
  readonly preFill = this._preFill.asReadonly();

  /** ArgoCD dashboard calls this before navigating */
  set(state: BranchComparePreFill | BranchComparePreFill[]) {
    if (Array.isArray(state)) {
      this._preFill.set(state);
    } else {
      this._preFill.set([state]);
    }
  }

  /** BranchCompareComponent calls this after reading the state */
  consume(): BranchComparePreFill[] | null {
    const val = this._preFill();
    this._preFill.set(null);
    return val;
  }
}
