# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Dev server (port 4201)
npm start

# Production build
npm run build

# Build with file watching
npm run watch

# Run tests (Vitest)
npm test

# Format code
npx prettier --write .
```

### Python backend (local dev)
```bash
cd python-ai
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Local dev (both processes together)
```bash
./start.sh   # starts ng serve (4201) + FastAPI (8000) in background; logs to logs/
./stop.sh    # gracefully stops via saved PIDs
```

### Docker
```bash
docker-compose up          # uses extra_hosts for company internal DNS
docker build -t dev-helper .
docker run -p 4201:4201 dev-helper
```

## Architecture

This is an **Angular 21 SPA** with a **Python FastAPI backend**, deployed as a Docker container where Nginx serves the static Angular build and proxies `/python-ai/*` to FastAPI on port 8000.

### Frontend (`src/app/`)

All routes are lazy-loaded standalone components. The app has no NgModules.

**Key layers:**

- `core/services/` — all injectable services (Firebase, Bitbucket, Jira, ArgoCD, Keycloak, AI providers, etc.)
- `core/models/` — TypeScript interfaces (Jira, Bitbucket)
- `core/interceptors/auth.interceptor.ts` — injects auth headers for Bitbucket and Jira API calls; in local dev rewrites absolute URLs to proxy paths (`/bitbucket-api`, `/jira-api`) to bypass CORS
- `core/config/service-registry.ts` — static + dynamic mapping of ArgoCD app names to Bitbucket project/repo
- `pages/` — one folder per route, each with `.component.ts`, `.html`, `.scss`
- `layout/topbar/` — the shared top navigation bar
- `shared/` — reusable pipes and small components

**Pages:**
| Route | Purpose |
|---|---|
| `dashboard` | Landing page overview |
| `pr-review` | AI-powered Bitbucket PR review via Gemini or OpenAI-compatible |
| `branch-compare` | Side-by-side diff between branches |
| `argocd-dashboard` | ArgoCD environment status + compare dialog |
| `gap-analysis` | Version gap analysis across ArgoCD environments |
| `my-tickets` | Personal Jira tickets |
| `json-viewer` | JSON/JSONPath inspector |
| `base64-viewer` | Base64 encode/decode utility |
| `token-gen` | Keycloak token generator |
| `crypto-dashboard` | Crypto price charts + AI predictions |
| `settings/:category` | Per-user config (Bitbucket, Jira, AI keys, Keycloak, ArgoCD, service registry) |

### Config & Auth flow

`AuthSessionService` — stores `username` + `domain` (`work`/`personal`) in `localStorage`. This is the session concept; there is no real OAuth here.

`AuthConfigService` — holds all API credentials as Angular `signal`s. On login, loads per-user private config from Firebase Firestore (`users/{username}/configs/{domain}`) and merges with shared global data (Keycloak envs, ArgoCD envs, service registry from `global/*` documents).

`FirebaseService` — wraps Firestore reads/writes. The Firebase project config is hardcoded in this file (`dev-helper-87942`).

### Python backend (`python-ai/`)

FastAPI app (`main.py`) mounting four routers:

| Router | Prefix | Purpose |
|---|---|---|
| `bitbucket_router.py` | `/bitbucket/` | Proxy to Bitbucket Server API, adds auth headers server-side |
| `jira_router.py` | `/jira/` | Proxy to Jira API |
| `argocd_router.py` | `/argocd/` | Proxy to ArgoCD instances |
| `openai_router.py` | `/openai/` | Proxy to any OpenAI-compatible provider (OpenRouter, etc.) |
| `prediction_server.py` | `/predict`, `/train`, etc. | Crypto AI using XGBoost + technical indicators |

Angular calls `/python-ai/{router-prefix}/*`; Nginx strips `/python-ai` and forwards to FastAPI.

### Proxy pattern (CORS)

In local dev, `auth.interceptor.ts` rewrites outgoing HTTP calls to Angular proxy paths (`/bitbucket-api`, `/jira-api`) defined in `angular.json`. In production (Docker), Nginx does the same rewrite at `/python-ai`. The Python backend is the only process that ever makes cross-origin requests to actual Bitbucket/Jira/ArgoCD servers.

### Service Registry

`service-registry.ts` maps ArgoCD sync tag names / image substrings → Bitbucket project + repository. The static `SERVICE_REGISTRY` object is intentionally empty in the repo; entries are managed dynamically via Firebase (`global/serviceRegistry` document) through the Settings page. `resolveServices()` tries dynamic entries first, then falls back to the static map.

## Code style

- Prettier: `printWidth: 100`, `singleQuote: true`, Angular HTML parser for `.html`
- TypeScript: `strict: true`, `strictTemplates: true`, target ES2022
- All new Angular code should use standalone components with signals (`signal()`, `.asReadonly()`) rather than `BehaviorSubject` or classic `@Input()`/`@Output()`
- Services are `providedIn: 'root'` — no module registration needed
