"""
Bitbucket Proxy Router
======================
Forwards all Bitbucket REST API calls server-side to bypass browser CORS/Strict-Origin
restrictions. Angular sends credentials + params in the POST body; this router
builds the Authorization header and calls Bitbucket directly.

Supports both Bitbucket Server (on-prem) with Bearer token auth.

Flow:
    Angular (browser) → POST /bitbucket/<endpoint> → FastAPI (this router) → Bitbucket Server
"""

from typing import Any, Dict, List, Optional

import requests
import urllib3
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Suppress InsecureRequestWarning for self-signed / on-prem certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter(prefix="/bitbucket", tags=["Bitbucket Proxy"])


# ── Shared helpers ────────────────────────────────────────────────────────────

def _auth_header(token: str) -> str:
    """Build Bearer token auth header."""
    return f"Bearer {token}"


def _bb_get(base_url: str, token: str, path: str, params: Dict = None) -> Any:
    """Perform a GET against Bitbucket Server and return parsed JSON."""
    url = base_url.rstrip("/") + path
    headers = {
        "Authorization": _auth_header(token),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=30, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Bitbucket authentication failed — check token.")
        if not resp.ok:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach Bitbucket server: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Bitbucket server timed out")


# ── Request models ────────────────────────────────────────────────────────────

class BBBase(BaseModel):
    base_url: str
    token: str


class BBProjectRequest(BBBase):
    pass


class BBRepoRequest(BBBase):
    project_key: str


class BBBranchRequest(BBBase):
    project_key: str
    repo_slug: str
    filter_text: Optional[str] = None
    start: Optional[int] = None
    limit: int = 20


class BBTagRequest(BBBase):
    project_key: str
    repo_slug: str
    filter_text: Optional[str] = None
    start: Optional[int] = None
    limit: int = 20


class BBPullRequestRequest(BBBase):
    project_key: str
    repo_slug: str
    pr_id: int


class BBPRCommitsRequest(BBBase):
    project_key: str
    repo_slug: str
    pr_id: int


class BBOpenPRsRequest(BBBase):
    project_key: str
    repo_slug: str


class BBCommitsBetweenRequest(BBBase):
    project_key: str
    repo_slug: str
    from_ref: str
    to_ref: str
    limit: int = 1000


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/projects")
def bb_get_projects(req: BBProjectRequest):
    """
    List all Bitbucket projects the token has access to.
    Returns { values: [...] }.
    """
    return _bb_get(req.base_url, req.token, "/rest/api/1.0/projects", {"limit": 100})


@router.post("/repos")
def bb_get_repos(req: BBRepoRequest):
    """
    List all repositories in a project.
    Returns { values: [...] }.
    """
    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/1.0/projects/{req.project_key}/repos",
        {"limit": 100}
    )


@router.post("/branches")
def bb_get_branches(req: BBBranchRequest):
    """
    List branches for a repository with optional filter and pagination.
    Returns Bitbucket paged response { values, isLastPage, nextPageStart, ... }.
    """
    params: Dict[str, Any] = {"limit": req.limit}
    if req.filter_text:
        params["filterText"] = req.filter_text
    if req.start is not None:
        params["start"] = req.start
    params["boostMatches"] = "true"

    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/latest/projects/{req.project_key}/repos/{req.repo_slug}/branches",
        params
    )



@router.post("/tags")
def bb_get_tags(req: BBTagRequest):
    """
    List tags for a repository with optional filter and pagination.
    Returns Bitbucket paged response.
    """
    params: Dict[str, Any] = {"limit": req.limit}
    if req.filter_text:
        params["filterText"] = req.filter_text
    if req.start is not None:
        params["start"] = req.start

    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}/tags",
        params
    )


@router.post("/pull-request")
def bb_get_pull_request(req: BBPullRequestRequest):
    """
    Fetch a single Pull Request by ID.
    Returns the raw Bitbucket PR object.
    """
    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}/pull-requests/{req.pr_id}"
    )


@router.post("/pull-request/commits")
def bb_get_pr_commits(req: BBPRCommitsRequest):
    """
    Fetch all commits for a Pull Request.
    Returns Bitbucket paged response { values: [...] }.
    """
    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}/pull-requests/{req.pr_id}/commits",
        {"limit": 1000}
    )


@router.post("/pull-requests/open")
def bb_get_open_prs(req: BBOpenPRsRequest):
    """
    Fetch open Pull Requests for a repository.
    Returns Bitbucket paged response { values: [...] }.
    """
    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}/pull-requests",
        {"state": "OPEN", "limit": 50}
    )


@router.post("/commits-between")
def bb_get_commits_between(req: BBCommitsBetweenRequest):
    """
    Fetch commits between two refs (branches or tags).
    Used for gap analysis and branch comparison.
    Returns Bitbucket paged response { values: [...] }.
    """
    return _bb_get(
        req.base_url, req.token,
        f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}/commits",
        {"since": req.from_ref, "until": req.to_ref, "limit": req.limit}
    )


# ── PR Diff ───────────────────────────────────────────────────────────────────

class BBPRDiffRequest(BBBase):
    project_key: str
    repo_slug: str
    pr_id: int
    context_lines: int = 5


@router.post("/pull-request/diff")
def bb_get_pr_diff(req: BBPRDiffRequest):
    """
    Fetch the unified diff for a Pull Request.
    Returns the raw diff text (text/plain) wrapped in { diff: '...' }.
    """
    url = (
        req.base_url.rstrip("/")
        + f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}"
        + f"/pull-requests/{req.pr_id}/diff"
    )
    headers = {
        "Authorization": _auth_header(req.token),
        "Accept": "text/plain",
    }
    params = {"contextLines": req.context_lines, "whitespace": "IGNORE_ALL"}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=60, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Bitbucket authentication failed — check token.")
        if not resp.ok:
            # Some Bitbucket servers return JSON diff instead of plain text
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return {"diff": resp.text}
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach Bitbucket server: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Bitbucket server timed out fetching diff")


# ── PR Comment ────────────────────────────────────────────────────────────────

class BBPRCommentRequest(BBBase):
    project_key: str
    repo_slug: str
    pr_id: int
    text: str
    # Optional inline anchor fields
    file_path: Optional[str] = None
    file_type: Optional[str] = None   # "TO" | "FROM"
    line: Optional[int] = None
    line_type: Optional[str] = None   # "CONTEXT" | "ADDED" | "REMOVED"


class BBCreatePRRequest(BBBase):
    project_key: str
    repo_slug: str
    source_branch: str
    target_branch: str
    title: str
    description: Optional[str] = ""


@router.post("/pull-request/comment")
def bb_post_pr_comment(req: BBPRCommentRequest):
    """
    Post a comment (general or inline) to a Bitbucket Pull Request.

    For inline comments supply file_path + line. For general PR-level comments
    omit those fields.
    """
    url = (
        req.base_url.rstrip("/")
        + f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}"
        + f"/pull-requests/{req.pr_id}/comments"
    )
    headers = {
        "Authorization": _auth_header(req.token),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    body: Dict[str, Any] = {"text": req.text}

    # Build inline anchor when file information is provided
    if req.file_path and req.line is not None:
        body["anchor"] = {
            "line": req.line,
            "lineType": req.line_type or "CONTEXT",
            "fileType": req.file_type or "TO",
            "path": req.file_path,
        }

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=30, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Bitbucket authentication failed — check token.")
        if not resp.ok:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach Bitbucket server: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Bitbucket server timed out posting comment")


# ── Create Pull Request ───────────────────────────────────────────────────────

def _branch_exists(base_url: str, token: str, project_key: str, repo_slug: str, branch_name: str) -> bool:
    """Return True if the given branch exists in the repo (uses filterText search)."""
    try:
        data = _bb_get(
            base_url, token,
            f"/rest/api/latest/projects/{project_key}/repos/{repo_slug}/branches",
            {"filterText": branch_name, "start": 0, "limit": 20, "boostMatches": "true"},
        )
        return any(b.get("displayId") == branch_name for b in data.get("values", []))
    except HTTPException:
        return False



def _find_open_pr(base_url: str, token: str, project_key: str, repo_slug: str, source_branch: str, target_branch: str) -> Optional[Dict]:
    """Return the first open PR matching source→target, or None."""
    try:
        data = _bb_get(
            base_url, token,
            f"/rest/api/1.0/projects/{project_key}/repos/{repo_slug}/pull-requests",
            {"state": "OPEN", "limit": 100, "at": f"refs/heads/{target_branch}"},
        )
        for pr in data.get("values", []):
            from_id = pr.get("fromRef", {}).get("displayId", "")
            to_id = pr.get("toRef", {}).get("displayId", "")
            if from_id == source_branch and to_id == target_branch:
                return pr
    except HTTPException:
        pass
    return None


@router.post("/pull-request/create")
def bb_create_pull_request(req: BBCreatePRRequest):
    """
    Create a Pull Request from source_branch → target_branch in a repository.

    Validation steps:
      1. Check source branch exists.
      2. Check target branch exists.
      3. Check if an open PR with the same from/to already exists (skip if so).
      4. Create the PR if all checks pass.

    Returns a structured status response so the Angular UI can show per-repo remarks.
    """
    # 1. Check source branch
    if not _branch_exists(req.base_url, req.token, req.project_key, req.repo_slug, req.source_branch):
        return {
            "status": "source_branch_missing",
            "pr_id": None,
            "pr_url": None,
            "message": f"Source branch '{req.source_branch}' not found in this repository.",
        }

    # 2. Check target branch
    if not _branch_exists(req.base_url, req.token, req.project_key, req.repo_slug, req.target_branch):
        return {
            "status": "target_branch_missing",
            "pr_id": None,
            "pr_url": None,
            "message": f"Target branch '{req.target_branch}' not found in this repository.",
        }

    # 3. Check for existing open PR
    existing = _find_open_pr(req.base_url, req.token, req.project_key, req.repo_slug, req.source_branch, req.target_branch)
    if existing:
        pr_url = existing.get("links", {}).get("self", [{}])[0].get("href", "")
        return {
            "status": "already_exists",
            "pr_id": existing.get("id"),
            "pr_url": pr_url,
            "message": f"PR #{existing.get('id')} already exists ({req.source_branch} → {req.target_branch}).",
        }

    # 4. Create the PR
    url = (
        req.base_url.rstrip("/")
        + f"/rest/api/1.0/projects/{req.project_key}/repos/{req.repo_slug}/pull-requests"
    )
    headers = {
        "Authorization": _auth_header(req.token),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    body = {
        "title": req.title,
        "description": req.description or "",
        "state": "OPEN",
        "open": True,
        "closed": False,
        "fromRef": {
            "id": f"refs/heads/{req.source_branch}",
            "repository": {
                "slug": req.repo_slug,
                "project": {"key": req.project_key},
            },
        },
        "toRef": {
            "id": f"refs/heads/{req.target_branch}",
            "repository": {
                "slug": req.repo_slug,
                "project": {"key": req.project_key},
            },
        },
        "locked": False,
        "reviewers": [],
    }

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=30, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Bitbucket authentication failed — check token.")
        if not resp.ok:
            return {
                "status": "error",
                "pr_id": None,
                "pr_url": None,
                "message": f"Bitbucket error {resp.status_code}: {resp.text[:300]}",
            }
        data = resp.json()
        pr_url = data.get("links", {}).get("self", [{}])[0].get("href", "")
        return {
            "status": "created",
            "pr_id": data.get("id"),
            "pr_url": pr_url,
            "message": f"PR #{data.get('id')} created successfully.",
        }
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach Bitbucket server: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Bitbucket server timed out creating PR")
