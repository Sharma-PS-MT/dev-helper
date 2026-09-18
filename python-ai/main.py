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
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from prediction_server import app as prediction_app   # Crypto AI routes
from argocd_router import router as argocd_router      # ArgoCD proxy routes
from jira_router import router as jira_router          # Jira proxy routes
from bitbucket_router import router as bitbucket_router  # Bitbucket proxy routes
from openai_router import router as openai_router        # OpenAI proxy routes
from csi_api_router import router as csi_api_router      # CSI Helper REST API v1
from feature_flags_router import router as feature_flags_router  # Feature flags proxy routes

app = FastAPI(
    title="CSI Helper API",
    version="4.1.0",
    description=(
        "CSI Helper Unified Backend: REST APIs for Environments, Modules, Streams, "
        "and Deployed Version Comparisons + ArgoCD Proxy + Jira Proxy + Bitbucket Proxy."
    ),
    docs_url=None,
    redoc_url=None,
    servers=[
        {"url": "/python-ai", "description": "Angular Dev Proxy (/python-ai)"},
        {"url": "http://localhost:8000", "description": "Direct Backend (Port 8000)"},
    ]
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

# ── Mount proxy & core API routers ─────────────────────────────────────────────
app.include_router(csi_api_router)
app.include_router(argocd_router)
app.include_router(jira_router)
app.include_router(bitbucket_router)
app.include_router(openai_router)
app.include_router(feature_flags_router)


# ── Interactive Documentation Handlers (Auto-detecting proxy prefix) ───────────
@app.get("/docs", include_in_schema=False)
async def swagger_ui_html():
    html_content = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CSI Helper API - Swagger UI</title>
<link type="text/css" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<link rel="shortcut icon" href="https://fastapi.tiangolo.com/img/favicon.png">
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
  // Auto-detect whether accessed through /python-ai reverse proxy or directly
  const isProxied = window.location.pathname.startsWith('/python-ai');
  const openapiUrl = isProxied ? '/python-ai/openapi.json' : '/openapi.json';

  const ui = SwaggerUIBundle({
    url: openapiUrl,
    dom_id: '#swagger-ui',
    layout: 'BaseLayout',
    deepLinking: true,
    showExtensions: true,
    showCommonExtensions: true,
    presets: [
      SwaggerUIBundle.presets.apis,
      SwaggerUIBundle.SwaggerUIStandalonePreset
    ],
  });
</script>
</body>
</html>"""
    return HTMLResponse(content=html_content)


@app.get("/redoc", include_in_schema=False)
async def redoc_html():
    html_content = """<!DOCTYPE html>
<html>
<head>
<title>CSI Helper API - ReDoc</title>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
<link rel="shortcut icon" href="https://fastapi.tiangolo.com/img/favicon.png">
<style>
  body {
    margin: 0;
    padding: 0;
  }
</style>
</head>
<body>
<noscript>
  ReDoc requires Javascript to function. Please enable it to browse the documentation.
</noscript>
<div id="redoc-container"></div>
<script src="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js"></script>
<script>
  // Auto-detect whether accessed through /python-ai reverse proxy or directly
  const isProxied = window.location.pathname.startsWith('/python-ai');
  const openapiUrl = isProxied ? '/python-ai/openapi.json' : '/openapi.json';

  Redoc.init(openapiUrl, {
    scrollYOffset: 0,
    hideDownloadButton: false,
    theme: {
      colors: {
        primary: {
          main: '#38bdf8'
        }
      }
    }
  }, document.getElementById('redoc-container'));
</script>
</body>
</html>"""
    return HTMLResponse(content=html_content)


@app.get("/health", tags=["Health"])
def health():
    return {
        "status": "ok",
        "version": "4.1.0",
        "services": {
            "csi_helper_api":   [
                "/api/v1/environments",
                "/api/v1/modules",
                "/api/v1/streams",
                "/api/v1/streams/{stream_key}/modules",
                "/api/v1/deployments",
                "/api/v1/deployments/compare",
                "/api/v1/deployments/modules/{module_key}",
                "/api/v1/release-gap",
                "/api/v1/release-gap/{module_key}",
                "/api/v1/diff/compare",
                "/api/v1/diff/pr"
            ],
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

