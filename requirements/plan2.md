# Implementation Plan — Phase 2: Feature Toggles Compare Page

> Based on [req 2.txt](file:///d:/Projects/Comapny/dev-helper/requirements/req%202.txt)

---

## Goal

Add a new page at `/feature-toggles` that allows users to **compare feature flags across multiple environments** — similar to how the ArgoCD Dashboard compares applications across environments. The page will:

1. Load all environments from the Keycloak IAM configs (same list used in `/token-gen`)
2. Let users select 2+ environments via checkbox chips (ArgoCD-style)
3. For each selected environment: auto-generate a Bearer token, then fetch feature flags from the CSI API
4. Display a comparison table — rows are flag names, columns are environments — highlighting differences

---

## API Details

**Endpoint** (per environment):
```
GET {baseUrl_without_auth}/csi-api/csi-java-base-utility/base/feature-flags
```

**Headers:**
```
Authorization: Bearer {generated_token}
Accept: application/json
x-group: {tenant-id}
```

**URL construction logic:** If `KeycloakEnvConfig.baseUrl` ends with `/auth`, strip that suffix. For example:
- `https://vidapreprod.hmg.com/auth` → `https://vidapreprod.hmg.com`
- `https://sso.company.com` → `https://sso.company.com` (no change)

**Response shape:**
```json
{
  "flags": [
    {
      "flag": "OR_5632",
      "state": "ENABLED",
      "defaultVariant": "true",
      "target": { "status": true },
      "variants": { "false": false, "true": true },
      "metadata": { "toggleType": "feature" }
    },
    {
      "flag": "enableCCBedRequestStatusColumn",
      "state": "ENABLED",
      "defaultVariant": "true",
      "target": {
        "status": false,
        "hospitalIds": [160]
      },
      "variants": { "false": false, "true": true },
      "metadata": {
        "ticketId": "V4-46108",
        "toggleType": "feature",
        "releaseVersion": "V4.0.2604_W3",
        "description": "Allow to revoke the finalized invoice in er screen"
      }
    }
  ]
}
```

---

## UI/UX Design

### Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Feature Toggles Compare                                        │
│  Compare feature flags across environments                      │
├─────────────────────────────────────────────────────────────────┤
│  Environments: [✓ dev] [✓ csi-uat] [ hmg-prod] [ s2-prod] ... │
│                                                     [Refresh]   │
├─────────────────────────────────────────────────────────────────┤
│  Filter: [________________] Show: [All ▾] Diffs: 42 / 350      │
├──────────────┬────────────────────┬─────────────────────────────┤
│  Flag Name   │   dev              │   csi-uat          │ ...    │
├──────────────┼────────────────────┼─────────────────────────────┤
│  OR_5632  ⓘ  │ 🟢 ENABLED         │ 🔴 DISABLED         │       │
│  enableXYZ ⓘ │ 🟡 PARTIAL (160)   │ 🟢 ENABLED          │       │
│  ...         │ ...                │ ...                │       │
└──────────────┴────────────────────┴─────────────────────────────┘
```

### State Display Rules

| Condition | Visual | Color |
|-----------|--------|-------|
| `state === 'ENABLED'` AND `target.status === true` AND no `hospitalIds` | 🟢 **ENABLED** | Green |
| `state === 'ENABLED'` AND `target.hospitalIds` exists (partially targeted) | 🟡 **PARTIAL** + hospitalIds tooltip | Amber/Orange |
| `state === 'DISABLED'` OR `target.status === false` (without hospitalIds) | 🔴 **DISABLED** | Red |
| Flag not present in this environment | ⚪ **N/A** | Gray |
| Env is loading | Spinner | — |

### Metadata Info Icon (ⓘ)

Clicking the info icon on a flag name shows a small popover/tooltip with:
- `toggleType` (feature / ops / experiment)
- `ticketId` (e.g. V4-46108)
- `releaseVersion` (e.g. V4.0.2604_W3)
- `description`

### Partial Targeting

When `target.hospitalIds` is present, the cell shows:
- **PARTIAL** badge in amber
- Small chip or tooltip showing the hospital IDs (e.g. `160, 170`)

### Comparison Highlighting

- Rows where all environments have the **same** effective state: normal background
- Rows where environments **differ**: highlighted with subtle amber/orange background, similar to ArgoCD's diff rows

### Filtering

- **Text filter**: search by flag name (instant filter)
- **Show dropdown**: All / Differences Only / Enabled Only / Disabled Only / Partial Only
- **Stats bar**: `42 differences / 350 total flags`

---

## Proposed Changes

### New Files

#### [NEW] `src/app/core/services/feature-toggle.service.ts`

A new Angular service responsible for:

1. **Generating a token** for a given `KeycloakEnvConfig` (reuses `KeycloakService.generateToken()`)
2. **Fetching feature flags** from the CSI API using the generated token
3. **URL logic**: strips `/auth` suffix from `baseUrl` to construct the CSI API URL

```typescript
@Injectable({ providedIn: 'root' })
export class FeatureToggleService {
  constructor(private http: HttpClient, private keycloak: KeycloakService) {}

  fetchFlags(config: KeycloakEnvConfig): Observable<FeatureFlag[]> {
    // 1. Generate token via KeycloakService
    // 2. Strip /auth from baseUrl
    // 3. GET {baseUrl}/csi-api/csi-java-base-utility/base/feature-flags
    //    with Authorization: Bearer {token} and x-group: {tenantId}
  }
}
```

**Interfaces:**
```typescript
export interface FeatureFlagTarget {
  status: boolean;
  hospitalIds?: number[];
}

export interface FeatureFlagMetadata {
  toggleType?: string;
  ticketId?: string;
  releaseVersion?: string;
  description?: string;
  [key: string]: any;
}

export interface FeatureFlag {
  flag: string;
  state: string;
  defaultVariant: string;
  target: FeatureFlagTarget;
  variants: { [key: string]: boolean };
  metadata: FeatureFlagMetadata;
}

export interface FeatureFlagResponse {
  flags: FeatureFlag[];
}
```

> **CORS Note**: The CSI API is on the same origin as Keycloak (same base URL). Since the Angular app already makes direct cross-origin calls to Keycloak for tokens, the same approach applies here. If CORS issues arise, the call can be proxied through the Python backend later.

---

#### [NEW] `src/app/pages/feature-toggles/feature-toggles.component.ts`

Standalone component following the ArgoCD Dashboard pattern:

**Key properties:**
- `envs = signal<EnvSelection[]>([])` — environment list from `authConfig.keycloakEnvs()`
- `flagRows = signal<FlagCompareRow[]>([])` — comparison table data
- `loading = signal<Set<string>>(new Set())` — per-env loading state
- `filter = signal('')` — search text
- `showMode = signal<'all' | 'diff' | 'enabled' | 'disabled' | 'partial'>('all')` — filter mode
- `envCache: Map<string, FeatureFlag[]>` — cached flags per env

**Key interfaces (component-local):**
```typescript
interface EnvSelection {
  config: KeycloakEnvConfig;
  selected: boolean;
  loading: boolean;
  error: string | null;
}

interface FlagCompareRow {
  flagName: string;
  metadata: FeatureFlagMetadata | null;  // from first env that has metadata
  envStates: { [envName: string]: FlagCellState };
  isDifferent: boolean;  // true if states differ across envs
}

interface FlagCellState {
  state: 'ENABLED' | 'DISABLED' | 'PARTIAL' | 'N/A';
  hospitalIds?: number[];
  rawFlag: FeatureFlag | null;
}
```

**Key methods:**
- `toggleEnv(env)` — select/deselect env, fetch flags on select
- `loadEnv(env)` — generates token + fetches flags + caches
- `buildTable()` — merges all cached flags into comparison rows
- `getEffectiveState(flag)` — determines ENABLED/DISABLED/PARTIAL
- `refresh()` — clears cache and reloads all selected envs

---

#### [NEW] `src/app/pages/feature-toggles/feature-toggles.component.html`

Template structure:
1. **Page header** — title, subtitle, refresh button
2. **Environment selector card** — chip-style env list (from keycloakEnvs)
3. **Filter bar** — text search + show mode dropdown + diff count
4. **Comparison table** — flag name column + one column per selected env

---

#### [NEW] `src/app/pages/feature-toggles/feature-toggles.component.scss`

Styles following the ArgoCD Dashboard pattern:
- `.page-container`, `.page-header` — standard page layout
- `.env-card`, `.env-chips`, `.env-chip` — environment selector
- `.table-card`, `.table-wrapper` — scrollable table container
- `.flag-state` variants: `.enabled` (green), `.disabled` (red), `.partial` (amber), `.na` (gray)
- `.diff-row` — highlighted amber background for differing rows
- `.metadata-tooltip` — info popover styling
- `.filter-bar` — search + dropdown layout

---

### Modified Files

#### [MODIFY] [app.routes.ts](file:///d:/Projects/Comapny/dev-helper/src/app/app.routes.ts)

Add new route before the wildcard:

```typescript
{
  path: 'feature-toggles',
  loadComponent: () => import('./pages/feature-toggles/feature-toggles.component').then(m => m.FeatureTogglesComponent),
},
```

#### [MODIFY] [app.ts](file:///d:/Projects/Comapny/dev-helper/src/app/app.ts)

Add navigation item to `navItems` array (after 'IAM Tokens'):

```typescript
{ label: 'Feature Toggles', icon: 'toggle_on', path: '/feature-toggles' },
```

---

## Summary of All File Changes

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/app/core/services/feature-toggle.service.ts` | **NEW** | Service: token gen + feature flags API call |
| 2 | `src/app/pages/feature-toggles/feature-toggles.component.ts` | **NEW** | Component: env selection, data loading, comparison logic |
| 3 | `src/app/pages/feature-toggles/feature-toggles.component.html` | **NEW** | Template: env chips, filter bar, comparison table |
| 4 | `src/app/pages/feature-toggles/feature-toggles.component.scss` | **NEW** | Styles: matching ArgoCD Dashboard look & feel |
| 5 | `src/app/app.routes.ts` | **MODIFY** | Add `/feature-toggles` route |
| 6 | `src/app/app.ts` | **MODIFY** | Add sidebar navigation item |

---

## Open Questions

> [!IMPORTANT]
> **1. CORS / Proxy requirement:**
> The feature-flags API is hosted on the same domain as the Keycloak server (e.g. `https://vidapreprod.hmg.com/csi-api/...`). Will the browser be able to make direct cross-origin requests with Bearer tokens, or do we need to proxy these calls through the Python backend (`/python-ai/...`)? If a proxy is needed, we'd add a new endpoint to the FastAPI backend.

> [!IMPORTANT]
> **2. Tenant ID source:**
> The `x-group` header needs the `tenant-id`. Should this come from the `tenantId` field we just added to `KeycloakEnvConfig` in Phase 1? If so, environments without a tenantId won't be able to fetch feature flags — should we show a warning or skip them?

> [!NOTE]
> **3. Flag name trimming:**
> The sample response shows flag names with leading/trailing spaces (e.g. `" OR_5632"`, `" enableCCBedRequestStatusColumn "`). The implementation will `.trim()` flag names before display and comparison.

---

## Verification Plan

### Manual Verification
- Navigate to `/feature-toggles` page from the sidebar
- Select 2+ environments and verify flags load correctly
- Verify diff highlighting when environments have different flag states
- Verify PARTIAL state rendering when `hospitalIds` is present
- Verify metadata tooltip shows ticketId, releaseVersion, description
- Verify filter and show-mode dropdown work
- Verify error handling when token generation fails or API is unreachable
