# Feature Implementation Plan

Generated from `req.txt`

---

## Phase 1 — Orodruin Base URL Configuration

### Goal
Add a new per-user config field `orodruinBaseUrl` that is saved to and loaded from Firebase alongside all other private credentials.

---

### Codebase Analysis

| Layer | Finding |
|---|---|
| `AppConfig` interface | Lives in `auth-config.service.ts` (L5-L32). All credential fields are declared here. Adding a field here propagates it through save/load automatically. |
| `DEFAULTS` constant | Same file, L69-88. Must add `orodruinBaseUrl: ''` to match the interface. |
| `AuthConfigService.save()` | Persists a `Partial<AppConfig>` to Firebase — no change required once the field is in the interface. |
| `FirebaseService` | `saveCredentials`/`loadCredentials` do a full `setDoc`/`getDoc` on the Firestore user document — field is automatically included. |
| Settings form | `settings.component.ts` L74-88. The reactive form is the source of truth. A new `formControlName` must be added to `fb.group({...})`. |
| Settings categories | The component uses an `activeCategory` signal. A new `orodruin` category is the cleanest approach. |

---

### Proposed Changes

#### 1. `src/app/core/services/auth-config.service.ts`

**`AppConfig` interface** — add field:
```ts
// Orodruin / Internal Gateway
orodruinBaseUrl: string;   // e.g. https://orodruin.cloudsolutions.com.sa/
```

**`DEFAULTS` constant** — add default:
```ts
orodruinBaseUrl: '',
```

---

#### 2. `src/app/pages/settings/settings.component.ts`

**`form` group** — add control after `openaiMaxTokens`:
```ts
orodruinBaseUrl: [''],
```

---

#### 3. `src/app/pages/settings/settings.component.html`

Add an **Orodruin** settings card shown when `activeCategory() === 'orodruin'`.
Add a page subtitle for the `orodruin` category.

---

#### 4. Navigation / Topbar

Add `orodruin` entry to the settings category nav links in `topbar.component.html`.

---

## Phase 2 — Branch Compare UX Overhaul

### Goal
1. Remove the `Compare` button and the classic compare results section (`class="results-layout fade-in-up mt-24"`).
2. Auto-trigger `analyzeGap()` as soon as both `fromRef` and `toRef` are selected and differ.
3. Improve the Analyze Gap result UI.

---

### Codebase Analysis

| Layer | Finding |
|---|---|
| Action buttons | `branch-compare.component.html` L122-145. Compare button at L124-131. Gap button at L132-140. |
| Classic compare results | L335-486 `<ng-container *ngIf="result() as res">`. To be removed. |
| Gap results | L158-324 `<ng-container *ngIf="gapResult() as gap">`. To be improved. |
| `compare()` method | `branch-compare.component.ts` L526-546. To be removed. |
| `analyzeGap()` method | Same file, L548-568. Will be auto-called via `effect()`. |
| Pre-fill flow | `_applyPreFill()` at L297-305. Must also trigger `analyzeGap()` after refs are set. |

---

### Proposed Changes

#### 1. `src/app/pages/branch-compare/branch-compare.component.ts`

- **Remove** `compare()` method and the `comparing` / `result` signals.
- **Add** an Angular `effect()` that calls `analyzeGap()` automatically when both `fromRef()` and `toRef()` are set and different.
- **Update** `_loadQueueItem()` to call `analyzeGap()` directly at end (for pre-fill flow).

```ts
// Auto-trigger effect (added in constructor)
effect(() => {
  const from = this.fromRef();
  const to = this.toRef();
  if (from && to && from !== to) {
    untracked(() => this.analyzeGap());
  }
});
```

---

#### 2. `src/app/pages/branch-compare/branch-compare.component.html`

**Remove:**
- Compare button block (L124-131)
- Classic compare loading block (L326-333)
- Entire classic results `<ng-container>` block (L335-486)

**Update action buttons** — keep only Analyze Gap + Clear.

**Improve gap results panel:**
- Sticky summary stats bar at top (Critical / Incoming / Shared as large colored counters)
- Commit cards with clear hierarchy: hash chip, author initial, prominent first-line message, subdued date
- Expandable commit body (click to expand full message)
- Per-column search/filter input to live-filter by message text
- Per-column copy button (markdown/Confluence format)
- Improved empty-state when both sides are in sync
- Color-coded column headers with border-left accent

---

#### 3. `src/app/pages/branch-compare/branch-compare.component.scss`

Add/update styles:
- `.gap-commit-card` — elevated card with left-border accent
- `.gap-commit-hash-chip` — pill shape with monospace font
- `.gap-col-search` — search input above each column
- `.gap-sticky-stats` — sticky top stats bar
- `.gap-empty-state` — centered icon + message

---

## File Impact Summary

| File | Phase | Change |
|---|---|---|
| `src/app/core/services/auth-config.service.ts` | 1 | Add `orodruinBaseUrl` to interface + defaults |
| `src/app/pages/settings/settings.component.ts` | 1 | Add form control |
| `src/app/pages/settings/settings.component.html` | 1 | Add Orodruin card + subtitle |
| `src/app/layout/topbar/topbar.component.html` | 1 | Add Orodruin nav link |
| `src/app/pages/branch-compare/branch-compare.component.ts` | 2 | Remove `compare()`, add auto-trigger effect |
| `src/app/pages/branch-compare/branch-compare.component.html` | 2 | Remove Compare button + results, improve gap UI |
| `src/app/pages/branch-compare/branch-compare.component.scss` | 2 | Gap result card styles |

---

## Open Questions

1. **Phase 1 — Category placement**: Should `orodruin` be a standalone settings nav tab, or a field within `bitbucket` (same work domain)?
2. **Phase 1 — Orodruin usage**: Is the URL consumed directly by Angular, or via the Python proxy (like Bitbucket/Jira)? If via proxy, an `auth.interceptor.ts` rewrite rule may also be needed.
3. **Phase 2 — Auto-trigger debounce**: Should `analyzeGap()` be debounced (e.g. 300 ms) to prevent double-firing during pre-fill when both refs are set in quick succession?
4. **Phase 2 — Remove `compare()` entirely?**: No other callers found in the graph — safe to remove.
