"""
Dev-Helper Microservice — Main Entry Point  (v4.0.0)
====================================================
Combines all feature routers into a single FastAPI application.

Routers registered:
  - Crypto AI Predictions  →  /predict  /train  /backtest  /sentiment
  - ArgoCD Proxy           →  /argocd/session  /argocd/applications
  - Jira Proxy             →  /jira/myself  /jira/issue  /jira/issues/batch
                               /jira/search
  - Bitbucket Proxy        →  /bitbucket/projects  /bitbucket/repos
                               /bitbucket/branches  /bitbucket/tags
                               /bitbucket/pull-request  /bitbucket/pull-request/commits
                               /bitbucket/pull-requests/open  /bitbucket/commits-between

Usage:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from prediction_server import app as prediction_app   # Crypto AI routes
from argocd_router import router as argocd_router      # ArgoCD proxy routes
from jira_router import router as jira_router          # Jira proxy routes
from bitbucket_router import router as bitbucket_router  # Bitbucket proxy routes
from openai_router import router as openai_router        # OpenAI proxy routes

app = FastAPI(
    title="Dev-Helper Microservice",
    version="4.0.0",
    description=(
        "Unified backend: Crypto AI predictions + ArgoCD proxy "
        "+ Jira proxy + Bitbucket proxy."
    )
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# ── Mount Crypto AI routes from prediction_server ──────────────────────────────
for route in prediction_app.routes:
    # Avoid duplicating the /health and /openapi.json routes
    if route.path not in ("/health", "/docs", "/redoc", "/openapi.json"):
        app.routes.append(route)

# ── Mount proxy routers ────────────────────────────────────────────────────────
app.include_router(argocd_router)
app.include_router(jira_router)
app.include_router(bitbucket_router)
app.include_router(openai_router)


@app.get("/health", tags=["Health"])
def health():
    return {
        "status": "ok",
        "version": "4.0.0",
        "services": {
            "crypto_ai":        ["/predict", "/train", "/backtest", "/sentiment"],
            "argocd_proxy":     ["/argocd/session", "/argocd/applications"],
            "jira_proxy":       [
                "/jira/myself", "/jira/issue", "/jira/issues/batch",
                "/jira/search"
            ],
            "bitbucket_proxy":  [
                "/bitbucket/projects", "/bitbucket/repos",
                "/bitbucket/branches", "/bitbucket/tags",
                "/bitbucket/pull-request", "/bitbucket/pull-request/commits",
                "/bitbucket/pull-requests/open", "/bitbucket/commits-between"
            ],
            "openai_proxy":     ["/openai/models", "/openai/chat/completions"]
        }
    }

