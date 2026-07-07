---
name: run-dev-helper
description: Build, launch, and drive the Dev-Helper app (Angular 21 frontend + Python FastAPI backend) in a browser. Use when asked to run dev-helper, start the dev server, take a screenshot of a page, verify a UI change actually works, or check that the /python-ai proxy reaches FastAPI.
---

# Running Dev-Helper

Dev-Helper is an Angular 21 SPA (port 4201) backed by a Python FastAPI
service (port 8000). In dev, Angular's dev-server proxy
(`proxy.conf.json`) forwards `/python-ai/*` to FastAPI so the browser
never makes a cross-origin call directly.

Paths below are relative to the repo root (`<unit>/`), i.e. one level
up from this skill directory
(`.claude/skills/run-dev-helper/driver files`).

## The one gotcha that blocks everything: Node version

This machine's active Node (whatever `node`/`npm` resolve to on PATH,
via the nvm-windows junction at `C:\Program Files\nodejs`) may be
**v12**, but Angular 21 requires **Node ≥20.19**. Check first:

```bash
node -v
```

If it's not ≥20.19, look for an already-installed newer version before
assuming you need to install anything:

```bash
find /c -maxdepth 4 -iname "node.exe" 2>/dev/null
```

On this machine a Node 20.19.4 install already exists at
`C:\Users\SarveswaraSarma\AppData\Roaming\nvm\v20.19.4\` but isn't the
active nvm version. Switching the active version (`nvm use 20.19.4`)
silently fails — it requires rewriting a symlink under
`C:\Program Files\nodejs`, which needs admin elevation this session
doesn't have. **Don't fight nvm.** Just prepend the newer install to
`PATH` for the current process tree:

```bash
export PATH="/c/Users/SarveswaraSarma/AppData/Roaming/nvm/v20.19.4:$PATH"
node -v   # should now print v20.19.4
```

This is exactly what `start-frontend.cmd` in this skill directory does
for Windows `cmd.exe` launches (see below) — it does not touch global
PATH or nvm, it only affects the child `npm start` process.

## Run (agent path) — Claude Preview tools

This is a browser-driven web app, so the driver is the `preview_*`
MCP tools (`preview_start`, `preview_screenshot`, `preview_click`,
`preview_fill`, `preview_eval`, `preview_snapshot`, `preview_logs`),
not a custom script.

**`.claude/launch.json`** (already committed) points `preview_start` at
`start-frontend.cmd` instead of a bare `npm start`, because
`preview_start` spawns its own process without this session's PATH
override — a bare `npm start` in `launch.json` resolves to the old
Node 12 and fails with `Node.js version v12.22.12 detected. The
Angular CLI requires... v20.19`.

1. Start the frontend (builds first, ~13s, then serves):
   ```
   preview_start({ name: "dev-helper-frontend" })
   ```
   If port 4201 is already occupied by a manually-started `ng serve`
   (e.g. left over from a previous session), stop it first — kill the
   node.exe process holding the port — then retry; `preview_start`
   refuses to reuse a port held by a non-preview process.

2. Start the FastAPI backend separately — `preview_start` only manages
   one process per config entry, and the backend has its own runtime
   (Python, not Node). Launch it as a background Bash command:
   ```bash
   cd python-ai && python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```
   Confirm it's up: `curl -s http://localhost:8000/health` should
   return `{"status":"ok", ...}`.

3. Drive the app:
   - `preview_screenshot` — visual check. First call after startup can
     take longer than 30s if Angular is still compiling; if it times
     out, check `preview_logs` for "Application bundle generation
     complete" before retrying rather than assuming failure.
   - `preview_snapshot` — accessibility tree, more reliable than
     screenshots for confirming exact text/element presence.
   - `preview_fill` / `preview_click` — the login form's username
     input has no stable CSS class (Angular Material auto-generates
     `mat-input-0`); inspect first (`preview_inspect` on `input`) to
     get the real `id`, don't guess a selector.
   - `preview_eval` — for verifying the dev proxy end-to-end:
     `fetch('/python-ai/health').then(r => r.json())` from the page
     context confirms Angular's proxy is actually reaching FastAPI,
     not just that FastAPI is up.
   - Login accepts **any non-empty username** — `AuthSessionService`
     has no real auth, it's just `localStorage`. Type anything, click
     "Enter Workspace", you're at `/dashboard`.

4. `preview_stop({ serverId })` when done.

## Run (human path)

```bash
export PATH="/c/Users/SarveswaraSarma/AppData/Roaming/nvm/v20.19.4:$PATH"
npm start                    # Angular, port 4201
cd python-ai && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload   # separate terminal
```
Or use the repo's own `./start.sh` / `./stop.sh` (Git Bash/WSL) — but
these also need the Node 20 PATH override first if run in a shell
where `node` still resolves to v12; `start.sh` only checks that *some*
node exists, not the version, so it will happily launch under Node 12
and then Angular will fail with the same version error.

## Build

```bash
export PATH="/c/Users/SarveswaraSarma/AppData/Roaming/nvm/v20.19.4:$PATH"
npm run build -- --configuration=production
```
Verified working — outputs to `dist/dev-helper/`, ~13s, no errors.

## Test

```bash
npm test    # ng test → Vitest
```
**Currently fails** with `No tests found matching **/*.spec.ts,
**/*.test.ts` — there are no spec files anywhere in `src/` right now.
This is not a build/environment problem; the project simply has zero
unit tests today. Don't treat this as something to "fix" by chasing a
config issue — it's accurate.

## Gotchas

- **Don't try to fix nvm.** Repointing the `C:\Program Files\nodejs`
  symlink requires admin elevation; attempts to `Remove-Item`/
  `New-Item -ItemType SymbolicLink` on it fail even with
  `-Force -Confirm:$false` in this sandboxed session (reports
  "NonInteractive mode" — that's the UAC prompt being swallowed, not a
  real syntax problem). The PATH-prepend workaround is the only thing
  that worked without elevation.
- **`preview_start` failing with the Node version error even after you
  fixed `PATH` in your own shell** means `launch.json` is still
  invoking a bare `npm`/`node` — it does not inherit your Bash/
  PowerShell session's exported `PATH`. Route it through a `.cmd` (or
  absolute `node.exe` path) that sets `PATH` itself, as `launch.json`
  in this repo already does.
- Login has two workspace domains ("Work Space" / "Personal Space" —
  scroll the carousel-style row of cards to see both); either works
  for reaching the dashboard, and nothing after login requires real
  Bitbucket/Jira/ArgoCD credentials to *navigate* — pages just show a
  "Setup Required" banner and empty states until Settings is
  configured.
- The double-card look on the login screen on first screenshot is not
  a bug — it's a horizontally-scrollable row of domain-selector cards
  with the second one partially in view; `preview_snapshot` confirms
  only one `<form>` exists in the DOM.
