# Implementation Plan — Requirements Batch

> Based on [req.txt](file:///d:/Projects/Comapny/dev-helper/requirements/req.txt)

---

## Requirement 1 & 3: Add Client-ID, Client-Secret, Tenant-ID Text Boxes to `/token-gen`

### Context

The current `/token-gen` page ([token-gen.component.ts](file:///d:/Projects/Comapny/dev-helper/src/app/pages/token-gen/token-gen.component.ts)) is a Keycloak IAM Manager that allows users to select an environment and fill in: **Base URL**, **Realm**, **Client ID**, **Username**, and **Password**. It then generates a bearer token via the [KeycloakService](file:///d:/Projects/Comapny/dev-helper/src/app/core/services/keycloak.service.ts).

The form already has a `clientId` field (OIDC Client ID). The requirement asks for three **new** text boxes — `client-secret` and `tenant-id` — to be added alongside the existing `clientId`, with proper validation and clear labels.

### Changes

#### 1. [MODIFY] [auth-config.service.ts](file:///d:/Projects/Comapny/dev-helper/src/app/core/services/auth-config.service.ts)

Add two new optional fields to the `KeycloakEnvConfig` interface:

```typescript
export interface KeycloakEnvConfig {
  envName: string;
  baseUrl: string;
  realm: string;
  clientId: string;
  appClientId?: string;    // NEW — Application specific Client ID
  clientSecret?: string;   // NEW — OIDC Client Secret (for confidential clients)
  tenantId?: string;        // NEW — Azure AD / OAuth2 Tenant ID
  username: string;
  password?: string;
}
```

> These are optional (`?`) so existing saved configurations remain backward-compatible.

#### 2. [MODIFY] [token-gen.component.ts](file:///d:/Projects/Comapny/dev-helper/src/app/pages/token-gen/token-gen.component.ts)

- Add `clientSecret` and `tenantId` form controls to the `FormGroup`:
  ```typescript
  this.form = this.fb.group({
    baseUrl: ['', Validators.required],
    realm: ['', Validators.required],
    clientId: ['frontend-client', Validators.required],
    clientSecret: [''],           // NEW — optional
    tenantId: [''],               // NEW — optional
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  ```
- Add a `showClientSecret` signal (similar to `showPassword`) for toggling the client-secret visibility.
- Update `onEnvChange()` to patch the new fields from saved config.
- Update `saveConfig()` to include the new fields in `KeycloakEnvConfig`.

#### 3. [MODIFY] [token-gen.component.html](file:///d:/Projects/Comapny/dev-helper/src/app/pages/token-gen/token-gen.component.html)

Add a new `form-row` section **after the Client ID field** (after line 51) with two new `mat-form-field` inputs:

```html
<div class="form-row">
  <mat-form-field appearance="outline" class="w-full">
    <mat-label>Client Secret</mat-label>
    <input matInput formControlName="clientSecret"
           [type]="showClientSecret() ? 'text' : 'password'"
           placeholder="Enter client secret (for confidential clients)" />
    <button mat-icon-button matSuffix type="button"
            (click)="showClientSecret.set(!showClientSecret())" tabindex="-1">
      <mat-icon>{{ showClientSecret() ? 'visibility_off' : 'visibility' }}</mat-icon>
    </button>
    <mat-hint>Required only for confidential OIDC clients</mat-hint>
  </mat-form-field>
  <mat-form-field appearance="outline" class="w-full">
    <mat-label>Tenant ID</mat-label>
    <input matInput formControlName="tenantId"
           placeholder="e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
    <mat-hint>Azure AD / OAuth2 tenant identifier</mat-hint>
  </mat-form-field>
</div>
```

**UI/UX Details:**
- Both fields use `appearance="outline"` to match the existing form style.
- Client Secret gets a visibility toggle (eye icon) — same pattern as the password field.
- Tenant ID gets a UUID-style placeholder for clarity.
- Both have `mat-hint` text describing when/why they're needed.
- Labels: "Client Secret" and "Tenant ID" — clear and standard.

#### 4. [MODIFY] [keycloak.service.ts](file:///d:/Projects/Comapny/dev-helper/src/app/core/services/keycloak.service.ts)

Update `generateToken()` to include `client_secret` in the form body when provided:

```typescript
if (config.clientSecret) {
  body.set('client_secret', config.clientSecret);
}
```

> `tenant-id` is a storage/configuration field — it doesn't participate in the Keycloak token request directly, but is saved with the environment config for reference.

---

## Requirement 2: Remove the Compare-Dialog Feature

### Context

The "compare-dialog" is the **ArgoCD Side-by-Side comparison dialog** — the [`ArgocdCompareDialogComponent`](file:///d:/Projects/Comapny/dev-helper/src/app/pages/argocd-dashboard/argocd-compare-dialog.component.ts). It is opened from the ArgoCD Dashboard page via a "Side-by-Side" button when a row with ≥2 environments is selected.

This component is **fully isolated** — standalone, opened via `MatDialog.open()`, no route, not used by any other component.

### Changes

#### 1. [DELETE] [argocd-compare-dialog.component.ts](file:///d:/Projects/Comapny/dev-helper/src/app/pages/argocd-dashboard/argocd-compare-dialog.component.ts)

Delete the entire file (202 lines). This is a standalone component with inline template and styles — no separate `.html` or `.scss` files to remove.

#### 2. [MODIFY] [argocd-dashboard.component.ts](file:///d:/Projects/Comapny/dev-helper/src/app/pages/argocd-dashboard/argocd-dashboard.component.ts)

| Line(s) | What to Remove |
|---------|---------------|
| L22 | `import { MatDialogModule, MatDialog } from '@angular/material/dialog';` |
| L32 | `import { ArgocdCompareDialogComponent } from './argocd-compare-dialog.component';` |
| L115–117 | `get canCompare(): boolean { return this.hasMultipleEnvs(); }` |
| L126 | `private dialog: MatDialog,` from constructor params |
| L223–237 | `openCompare()` method (entire block including comment) |

Also remove `MatDialogModule` from the `imports` array in the `@Component` decorator (it's only used for the compare dialog).

> **Keep** `hasMultipleEnvs()` and `hasExactlyTwoEnvs()` — they're still used by the Branch Compare tooltip.

#### 3. [MODIFY] [argocd-dashboard.component.html](file:///d:/Projects/Comapny/dev-helper/src/app/pages/argocd-dashboard/argocd-dashboard.component.html)

| Line(s) | What to Remove |
|---------|---------------|
| L24–27 | The "Side-by-Side" button block: `<!-- Side-by-side detail dialog: 1 row with >=2 envs -->` through `</button>` |
| L162 | The span `<span *ngIf="canCompare"> — ready to compare environments</span>` |

#### 4. [MODIFY] [argocd-dashboard.component.scss](file:///d:/Projects/Comapny/dev-helper/src/app/pages/argocd-dashboard/argocd-dashboard.component.scss)

| Line(s) | What to Remove |
|---------|---------------|
| L187–193 | `.compare-btn { ... }` style block |

> **Keep** the `::ng-deep .dark-dialog` style — it's shared with other parts of the app.

---

## Summary of All File Changes

| # | File | Action | Requirement |
|---|------|--------|-------------|
| 1 | `src/app/core/services/auth-config.service.ts` | MODIFY — add `clientSecret?`, `tenantId?` to interface | Req 1 & 3 |
| 2 | `src/app/pages/token-gen/token-gen.component.ts` | MODIFY — add form controls, signals, patch logic | Req 1 & 3 |
| 3 | `src/app/pages/token-gen/token-gen.component.html` | MODIFY — add 2 new `mat-form-field` inputs with labels/hints | Req 1 & 3 |
| 4 | `src/app/core/services/keycloak.service.ts` | MODIFY — send `client_secret` in token request | Req 1 |
| 5 | `src/app/pages/argocd-dashboard/argocd-compare-dialog.component.ts` | DELETE | Req 2 |
| 6 | `src/app/pages/argocd-dashboard/argocd-dashboard.component.ts` | MODIFY — remove import, getter, method, dialog injection | Req 2 |
| 7 | `src/app/pages/argocd-dashboard/argocd-dashboard.component.html` | MODIFY — remove button and footer span | Req 2 |
| 8 | `src/app/pages/argocd-dashboard/argocd-dashboard.component.scss` | MODIFY — remove `.compare-btn` style | Req 2 |

## Verification

- `ng build` — ensure the project compiles cleanly with no errors.
- Manually verify `/token-gen` page renders the new fields with proper labels and hints.
- Verify ArgoCD dashboard no longer shows the "Side-by-Side" button.
- Verify no console errors or broken references.
