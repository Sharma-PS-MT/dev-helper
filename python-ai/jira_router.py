"""
Jira Proxy Router
=================
Forwards all Jira REST API calls server-side to bypass browser CORS/Strict-Origin
restrictions. Angular sends credentials + params in the POST body; this router
builds the Authorization header and calls Jira directly.

Flow:
    Angular (browser) → POST /jira/<endpoint> → FastAPI (this router) → Jira Cloud/Server
"""

import base64
from typing import Any, Dict, List, Optional

import requests
import urllib3
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Suppress InsecureRequestWarning for self-signed certs (on-prem Jira)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter(prefix="/jira", tags=["Jira Proxy"])


# ── Shared helpers ────────────────────────────────────────────────────────────

def _auth_header(email: str, token: str) -> str:
    """Build a Basic-auth header from Jira email + API token."""
    encoded = base64.b64encode(f"{email}:{token}".encode()).decode()
    return f"Basic {encoded}"


def _jira_get(base_url: str, email: str, token: str, path: str, params: Dict = None) -> Any:
    """Perform a GET against Jira and return parsed JSON; raises HTTPException on error."""
    url = base_url.rstrip("/") + path
    headers = {
        "Authorization": _auth_header(email, token),
        "Accept": "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Jira authentication failed — check email/token.")
        if not resp.ok:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach Jira server: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Jira server timed out")


# ── Request models ────────────────────────────────────────────────────────────

class JiraBase(BaseModel):
    base_url: str
    email: str
    token: str


class JiraIssueRequest(JiraBase):
    key: str


class JiraIssuesBatchRequest(JiraBase):
    keys: List[str]
    fields: str = "summary,status,priority,assignee,reporter,issuetype,created,updated"
    max_results: int = 50


class JiraSearchRequest(JiraBase):
    jql: str
    max_results: int = 100
    fields: str = "summary,status,priority,assignee,reporter,issuetype,created,updated,timespent"
    start_at: int = 0


class JiraWorklogRequest(JiraBase):
    issue_key: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/myself")
def jira_myself(req: JiraBase):
    """
    Test connection and retrieve the authenticated user's Jira profile.
    Returns accountId, displayName, emailAddress.
    """
    data = _jira_get(req.base_url, req.email, req.token, "/rest/api/2/myself")
    return {
        "accountId": data.get("accountId"),
        "displayName": data.get("displayName"),
        "emailAddress": data.get("emailAddress"),
    }


@router.post("/issue")
def jira_get_issue(req: JiraIssueRequest):
    """
    Fetch a single Jira issue by key.
    Returns the raw Jira issue object.
    """
    return _jira_get(req.base_url, req.email, req.token, f"/rest/api/2/issue/{req.key}")


@router.post("/issues/batch")
def jira_get_issues_batch(req: JiraIssuesBatchRequest):
    """
    Fetch multiple Jira issues by keys (up to 50 per call, batched server-side).
    Returns { issues: [...] } matching Jira search result shape.
    """
    if not req.keys:
        return {"issues": []}

    all_issues: List[Any] = []
    # Batch in groups of 50
    for i in range(0, len(req.keys), 50):
        batch = req.keys[i : i + 50]
        jql = f"key in ({','.join(batch)})"
        params = {
            "jql": jql,
            "maxResults": req.max_results,
            "fields": req.fields,
        }
        data = _jira_get(req.base_url, req.email, req.token, "/rest/api/3/search/jql", params)
        all_issues.extend(data.get("issues", []))

    return {"issues": all_issues}


@router.post("/search")
def jira_search(req: JiraSearchRequest):
    """
    Run an arbitrary JQL search.
    Returns { issues: [...], total: N } matching Jira search result shape.
    """
    params = {
        "jql": req.jql,
        "maxResults": req.max_results,
        "fields": req.fields,
        "startAt": req.start_at,
    }
    data = _jira_get(req.base_url, req.email, req.token, "/rest/api/3/search/jql", params)
    return {"issues": data.get("issues", []), "total": data.get("total", 0)}


@router.post("/worklog")
def jira_get_worklog(req: JiraWorklogRequest):
    """
    Fetch all worklogs for a specific Jira issue key.
    Returns { worklogs: [...] }.
    """
    data = _jira_get(
        req.base_url, req.email, req.token,
        f"/rest/api/2/issue/{req.issue_key}/worklog"
    )
    return {"worklogs": data.get("worklogs", [])}
