"""
CSI Helper API Router (v1)
==========================
Exposes REST endpoints for:
  - Environment list
  - Module list
  - Module list under stream key
  - Module-environment deployed versions & comparison
"""

import os
from typing import List, Dict, Optional, Any
from fastapi import APIRouter, HTTPException, Query, Header, Depends, status
from pydantic import BaseModel, Field

from csi_config import (
    ARGO_ENVIRONMENTS,
    get_all_environments,
    KNOWN_SERVICES,
    get_all_services,
    refresh_services_cache,
    resolve_environment,
    resolve_service,
    get_all_streams,
    get_services_by_stream,
    ServiceRegistryEntry
)
from csi_service import csi_service


router = APIRouter(prefix="/api/v1", tags=["CSI Helper API"])


# ─────────────────────────────────────────────────────────────────────────────
# AUTHENTICATION DEPENDENCY
# ─────────────────────────────────────────────────────────────────────────────
def verify_api_key(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key", description="API Key for authorization"),
    authorization: Optional[str] = Header(None, description="Bearer token authorization")
) -> str:
    """
    Validates API key or Bearer token.
    As per specifications, dummy API key is accepted and not strictly enforced.
    """
    key = x_api_key
    if not key and authorization:
        if authorization.lower().startswith("bearer "):
            key = authorization[7:].strip()
        else:
            key = authorization.strip()

    # For now dummy API key is accepted / not validated
    return key or "dummy-api-key"


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMAS
# ─────────────────────────────────────────────────────────────────────────────
class EnvironmentResponse(BaseModel):
    id: str
    name: str
    url: str
    aliases: List[str]
    is_production: bool


class StreamSummary(BaseModel):
    stream: str
    module_count: int
    modules: List[str]


class DeploymentCompareRequest(BaseModel):
    environments: List[str] = Field(
        ...,
        min_length=1,
        description="List of environment IDs or aliases (e.g. ['dev', 'vida-uat'])"
    )
    modules: Optional[List[str]] = Field(
        default=None,
        description="Optional list of module keys or repo names to limit comparison"
    )
    stream: Optional[str] = Field(
        default=None,
        description="Optional stream key to filter modules (e.g. 'BM')"
    )
    refresh: bool = Field(
        default=False,
        description="Set to true to bypass cache and fetch fresh state from ArgoCD"
    )


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/environments",
    response_model=List[EnvironmentResponse],
    summary="Get environment list",
    description="Retrieves list of all configured ArgoCD deployment environments directly from Firebase Firestore single source of truth."
)
def get_environments(
    search: Optional[str] = Query(None, description="Filter environments by name, id, or alias"),
    refresh: bool = Query(False, description="Force refresh from Firebase Firestore"),
    api_key: str = Depends(verify_api_key)
):
    results: List[EnvironmentResponse] = []
    q = search.lower().strip() if (search and isinstance(search, str)) else None
    do_refresh = refresh if isinstance(refresh, bool) else False
    envs = get_all_environments(force_refresh=do_refresh)

    for env in envs:
        if q:
            match = (
                q in env.id.lower() or
                q in env.name.lower() or
                any(q in alias.lower() for alias in env.aliases)
            )
            if not match:
                continue

        results.append(
            EnvironmentResponse(
                id=env.id,
                name=env.name,
                url=env.url,
                aliases=env.aliases,
                is_production=env.is_production
            )
        )
    return results


@router.post(
    "/environments/refresh",
    summary="Refresh environment list from Firebase",
    description="Forces an immediate cache invalidation and reload of ArgoCD environments from Firebase Firestore."
)
def refresh_environments(api_key: str = Depends(verify_api_key)):
    envs = get_all_environments(force_refresh=True)
    return {
        "status": "success",
        "source": "Firebase Firestore (global/argocd)",
        "count": len(envs),
        "environments": [e.name for e in envs]
    }


@router.get(
    "/modules",
    response_model=List[ServiceRegistryEntry],
    summary="Get module list",
    description="Retrieves list of all registered CSI modules and services directly from the Firebase Firestore single source of truth."
)
def get_modules(
    stream: Optional[str] = Query(None, description="Filter modules by stream key (e.g. 'BM', 'PMS')"),
    project: Optional[str] = Query(None, description="Filter modules by Bitbucket/Jira project"),
    search: Optional[str] = Query(None, description="Search across key, displayName, repo, or aliases"),
    refresh: bool = Query(False, description="Force refresh from Firebase Firestore"),
    api_key: str = Depends(verify_api_key)
):
    do_refresh = refresh if isinstance(refresh, bool) else False
    results = get_all_services(force_refresh=do_refresh)

    if stream and isinstance(stream, str):
        s_lower = stream.strip().lower()
        results = [m for m in results if m.stream and m.stream.strip().lower() == s_lower]

    if project and isinstance(project, str):
        p_lower = project.strip().lower()
        results = [m for m in results if m.project.strip().lower() == p_lower]

    if search and isinstance(search, str):
        q = search.strip().lower()
        results = [
            m for m in results
            if (
                q in m.key.lower() or
                q in m.displayName.lower() or
                q in m.repository.lower() or
                any(q in a.lower() for a in m.aliases)
            )
        ]

    return results


@router.post(
    "/modules/refresh",
    summary="Refresh module list from Firebase",
    description="Forces an immediate cache invalidation and reload of the service registry from Firebase Firestore."
)
def refresh_modules(api_key: str = Depends(verify_api_key)):
    services = refresh_services_cache()
    return {
        "status": "success",
        "source": "Firebase Firestore (global/serviceRegistry)",
        "count": len(services),
        "modules": [s.key for s in services]
    }


@router.get(
    "/streams",
    response_model=List[StreamSummary],
    summary="Get stream list",
    description="Lists all stream keys along with module counts and lists."
)
def get_streams(
    api_key: str = Depends(verify_api_key)
):
    stream_keys = get_all_streams()
    summaries: List[StreamSummary] = []

    for sk in stream_keys:
        svcs = get_services_by_stream(sk)
        summaries.append(
            StreamSummary(
                stream=sk,
                module_count=len(svcs),
                modules=[s.displayName for s in svcs]
            )
        )
    return summaries


@router.get(
    "/streams/{stream_key}/modules",
    response_model=List[ServiceRegistryEntry],
    summary="Get module list under stream key",
    description="Returns all registered modules belonging to the specified stream key."
)
def get_modules_by_stream_key(
    stream_key: str,
    api_key: str = Depends(verify_api_key)
):
    modules = get_services_by_stream(stream_key)
    if not modules:
        # Check if stream exists
        all_s = get_all_streams()
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stream '{stream_key}' not found or has no modules. Available streams: {', '.join(all_s)}"
        )
    return modules


@router.get(
    "/deployments",
    summary="Get deployed versions for modules & environments",
    description="Queries deployed versions for modules across one or more environments."
)
def get_deployments(
    envs: str = Query(..., description="Comma-separated environment IDs (e.g. 'dev,vida-uat')"),
    modules: Optional[str] = Query(None, description="Comma-separated module keys or repos"),
    stream: Optional[str] = Query(None, description="Stream key filter"),
    refresh: bool = Query(False, description="Whether to bypass cache"),
    api_key: str = Depends(verify_api_key)
):
    env_list = [e.strip() for e in envs.split(",") if e.strip()]
    mod_list = [m.strip() for m in modules.split(",") if m.strip()] if modules else None

    try:
        return csi_service.compare_deployments(
            env_ids=env_list,
            module_queries=mod_list,
            stream_key=stream,
            refresh=refresh
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/deployments/compare",
    summary="Compare deployed versions across environments",
    description="Side-by-side version comparison across environments for module(s) or a stream."
)
def compare_deployments_post(
    req: DeploymentCompareRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.compare_deployments(
            env_ids=req.environments,
            module_queries=req.modules,
            stream_key=req.stream,
            refresh=req.refresh
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/deployments/modules/{module_key}",
    summary="Get deployed versions for a single module",
    description="Looks up deployed version for a single module across environments."
)
def get_single_module_deployment(
    module_key: str,
    envs: Optional[str] = Query(None, description="Comma-separated environment IDs (default: dev,vida-uat,hmg-prod)"),
    refresh: bool = Query(False, description="Whether to bypass cache"),
    api_key: str = Depends(verify_api_key)
):
    svc = resolve_service(module_key)
    if not svc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module '{module_key}' not found in service registry."
        )

    target_envs = (
        [e.strip() for e in envs.split(",") if e.strip()]
        if envs
        else ["dev", "vida-uat", "hmg-prod"]
    )

    try:
        result = csi_service.compare_deployments(
            env_ids=target_envs,
            module_queries=[svc.key],
            refresh=refresh
        )
        module_res = result["modules"][0] if result["modules"] else None
        return {
            "module": module_res,
            "environments": result["environments"],
            "errors": result.get("errors")
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# RELEASE GAP & DIFF MODELS
# ─────────────────────────────────────────────────────────────────────────────
class ReleaseGapRequest(BaseModel):
    source_env: Optional[str] = Field(None, description="Source environment (e.g. 'dev')")
    target_env: Optional[str] = Field(None, description="Target environment (e.g. 'vida-uat' or 'hmg-prod')")
    modules: Optional[List[str]] = Field(None, description="Optional module keys or repo slugs")
    stream: Optional[str] = Field(None, description="Optional stream key filter")
    from_ref: Optional[str] = Field(None, description="Direct base tag/branch override")
    to_ref: Optional[str] = Field(None, description="Direct target tag/branch override")
    refresh: bool = Field(False, description="Set to true to bypass ArgoCD cache")


class DiffCompareRequest(BaseModel):
    module: str = Field(..., description="Module key or repository slug (e.g. 'BM_APPROVAL_UI')")
    from_ref: Optional[str] = Field(None, description="Base commit/branch/tag (e.g. 'V4.0.2607_W4-14713_prod')")
    to_ref: Optional[str] = Field(None, description="Target commit/branch/tag (e.g. 'V4.0.2609_W4-15750_dev')")
    source_env: Optional[str] = Field(None, description="Resolve base tag from environment (e.g. 'vida-uat')")
    target_env: Optional[str] = Field(None, description="Resolve target tag from environment (e.g. 'dev')")
    include_patch: bool = Field(True, description="Whether to include unified diff patch")
    max_patch_lines: int = Field(500, description="Maximum lines of patch to return before truncating")
    refresh: bool = Field(False, description="Set to true to bypass ArgoCD cache")


class PRDiffApiRequest(BaseModel):
    module: Optional[str] = Field(None, description="Module key or repository slug")
    repo_slug: Optional[str] = Field(None, description="Bitbucket repository slug")
    project_key: Optional[str] = Field(None, description="Bitbucket project key (defaults from module)")
    pr_id: int = Field(..., description="Pull Request ID")
    base_url: Optional[str] = Field(None, description="Optional Bitbucket Server base URL")
    token: Optional[str] = Field(None, description="Optional Bitbucket personal access token")


# ─────────────────────────────────────────────────────────────────────────────
# RELEASE GAP ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/release-gap",
    summary="Analyze release gap (POST)",
    description="Performs release gap analysis between environments or tags, reporting forward and reverse commits and Jira tickets."
)
def analyze_release_gap_post(
    req: ReleaseGapRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.analyze_release_gap(
            source_env=req.source_env,
            target_env=req.target_env,
            module_queries=req.modules,
            stream_key=req.stream,
            from_ref=req.from_ref,
            to_ref=req.to_ref,
            refresh=req.refresh
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/release-gap",
    summary="Analyze release gap (GET)",
    description="Queries release gap between source and target environments or refs."
)
def analyze_release_gap_get(
    source_env: Optional[str] = Query(None, description="Source environment (e.g. 'dev')"),
    target_env: Optional[str] = Query(None, description="Target environment (e.g. 'vida-uat')"),
    modules: Optional[str] = Query(None, description="Comma-separated module keys or repos"),
    stream: Optional[str] = Query(None, description="Stream key filter"),
    from_ref: Optional[str] = Query(None, description="Base ref/tag"),
    to_ref: Optional[str] = Query(None, description="Target ref/tag"),
    refresh: bool = Query(False, description="Set to true to bypass cache"),
    api_key: str = Depends(verify_api_key)
):
    mod_list = [m.strip() for m in modules.split(",") if m.strip()] if modules else None
    try:
        return csi_service.analyze_release_gap(
            source_env=source_env,
            target_env=target_env,
            module_queries=mod_list,
            stream_key=stream,
            from_ref=from_ref,
            to_ref=to_ref,
            refresh=refresh
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/release-gap/{module_key}",
    summary="Analyze release gap for a single module",
    description="Release gap analysis for a specific module between environments or tags."
)
def analyze_single_module_release_gap(
    module_key: str,
    source_env: Optional[str] = Query(None, description="Source environment (e.g. 'dev')"),
    target_env: Optional[str] = Query(None, description="Target environment (e.g. 'vida-uat')"),
    from_ref: Optional[str] = Query(None, description="Base ref/tag"),
    to_ref: Optional[str] = Query(None, description="Target ref/tag"),
    refresh: bool = Query(False, description="Set to true to bypass cache"),
    api_key: str = Depends(verify_api_key)
):
    try:
        res = csi_service.analyze_release_gap(
            source_env=source_env,
            target_env=target_env,
            module_queries=[module_key],
            from_ref=from_ref,
            to_ref=to_ref,
            refresh=refresh
        )
        mod_result = res["modules"][0] if res["modules"] else None
        return {
            "source_env": res["source_env"],
            "target_env": res["target_env"],
            "module": mod_result,
            "all_ticket_ids": res["all_ticket_ids"]
        }
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# DIFF COMPARE & PR DIFF ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/diff/compare",
    summary="Compare diff between refs or environments (POST)",
    description="Calculates file modifications, additions, deletions, commit logs, Jira tickets, and unified patch."
)
def compare_diff_post(
    req: DiffCompareRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.compare_diff(
            module_query=req.module,
            from_ref=req.from_ref,
            to_ref=req.to_ref,
            source_env=req.source_env,
            target_env=req.target_env,
            include_patch=req.include_patch,
            max_patch_lines=req.max_patch_lines,
            refresh=req.refresh
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/diff/compare",
    summary="Compare diff between refs or environments (GET)",
    description="Calculates file modifications, additions, deletions, commit logs, Jira tickets, and unified patch."
)
def compare_diff_get(
    module: str = Query(..., description="Module key or repository slug"),
    from_ref: Optional[str] = Query(None, description="Base ref/tag"),
    to_ref: Optional[str] = Query(None, description="Target ref/tag"),
    source_env: Optional[str] = Query(None, description="Source environment"),
    target_env: Optional[str] = Query(None, description="Target environment"),
    include_patch: bool = Query(True, description="Whether to include unified diff patch"),
    max_patch_lines: int = Query(500, description="Max lines of patch"),
    refresh: bool = Query(False, description="Whether to bypass cache"),
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.compare_diff(
            module_query=module,
            from_ref=from_ref,
            to_ref=to_ref,
            source_env=source_env,
            target_env=target_env,
            include_patch=include_patch,
            max_patch_lines=max_patch_lines,
            refresh=refresh
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/diff/pr",
    summary="Get Pull Request diff (POST)",
    description="Fetches unified diff and commits for a Pull Request from Bitbucket Server."
)
def get_pr_diff_post(
    req: PRDiffApiRequest,
    api_key: str = Depends(verify_api_key)
):
    repo = req.repo_slug
    project = req.project_key

    if not repo and req.module:
        svc = resolve_service(req.module)
        if svc:
            repo = svc.repository
            project = project or svc.project
        else:
            repo = req.module

    if not repo:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Must provide repo_slug or module.")

    project = project or "BM"

    try:
        return csi_service.get_pr_diff(
            project_key=project,
            repo_slug=repo,
            pr_id=req.pr_id,
            base_url=req.base_url,
            token=req.token
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/diff/pr",
    summary="Get Pull Request diff (GET)",
    description="Fetches unified diff and commits for a Pull Request from Bitbucket Server."
)
def get_pr_diff_get(
    pr_id: int = Query(..., description="Pull Request ID"),
    module: Optional[str] = Query(None, description="Module key or repository slug"),
    repo_slug: Optional[str] = Query(None, description="Bitbucket repository slug"),
    project_key: Optional[str] = Query(None, description="Bitbucket project key"),
    api_key: str = Depends(verify_api_key)
):
    repo = repo_slug
    project = project_key

    if not repo and module:
        svc = resolve_service(module)
        if svc:
            repo = svc.repository
            project = project or svc.project
        else:
            repo = module

    if not repo:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Must provide repo_slug or module.")

    project = project or "BM"

    try:
        return csi_service.get_pr_diff(
            project_key=project,
            repo_slug=repo,
            pr_id=pr_id
        )
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# FEATURE TOGGLES & CONFIG CACHE ENDPOINTS (LIVE BASE-UTILITY)
# ─────────────────────────────────────────────────────────────────────────────
class FeatureToggleRequest(BaseModel):
    category: Optional[str] = Field(default=None, description="Category filter ('ops', 'release', 'experiment', 'permission', 'all')")
    search: Optional[str] = Field(default=None, description="Search query for toggle name")
    hospital_id: Optional[str] = Field(default=None, description="Specific hospital ID to query (defaults to first available)")
    hospital_group_id: Optional[str] = Field(default=None, description="Hospital Group ID (default: env default or '110')")
    module_key: str = Field(default="rms", description="Module key for config utility (default: 'rms')")
    raw: bool = Field(default=False, description="Return raw hospital cache response without parsing")


class FeatureToggleCompareRequest(BaseModel):
    env1: str = Field(..., description="First environment (e.g. 'dev', 's1-prod', 's2-prod')")
    env2: str = Field(..., description="Second environment (e.g. 's1-prod', 's3-prod')")
    category: Optional[str] = Field(default=None, description="Category filter ('ops', 'release', 'experiment', 'permission', 'all')")
    search: Optional[str] = Field(default=None, description="Search query for toggle name")
    hospital_id1: Optional[str] = Field(default=None, description="Hospital ID for env1")
    hospital_id2: Optional[str] = Field(default=None, description="Hospital ID for env2")


class ConfigCacheRequest(BaseModel):
    keys: List[str] = Field(default_factory=lambda: ["FEATURE_TOGGLES"], description="Configuration keys to query")
    hospital_group_id: Optional[str] = Field(default=None, description="Hospital Group ID")
    hospital_ids: Optional[List[str]] = Field(default=None, description="List of hospital IDs")
    module_key: str = Field(default="rms", description="Module key")
    force_refresh_token: bool = Field(default=False, description="Bypass Keycloak token cache")


class RawCacheProxyRequest(BaseModel):
    env: str = Field(..., description="Target environment ID or alias (e.g. 's1-prod', 'dev')")
    hospitalGroupId: Optional[str] = Field(default=None, description="Hospital group ID")
    hospitalIds: Optional[List[str]] = Field(default=None, description="List of hospital IDs")
    keys: List[str] = Field(default_factory=lambda: ["FEATURE_TOGGLES"], description="Keys to fetch")
    moduleKey: str = Field(default="rms", description="Module key")


@router.get(
    "/environments/{env_id}/feature-toggles",
    summary="Get environment feature toggles",
    description=(
        "Retrieves and parses live feature toggles from the base-utility hospital cache for an environment. "
        "Automatically obtains Keycloak credentials, resolves the environment base URL, and filters toggles by category or search query."
    )
)
def get_environment_feature_toggles(
    env_id: str,
    category: Optional[str] = Query(None, description="Category filter ('ops', 'release', 'experiment', 'permission', 'all')"),
    search: Optional[str] = Query(None, description="Search query matching toggle name"),
    hospital_id: Optional[str] = Query(None, description="Hospital ID (e.g. '330' or '1')"),
    hospital_group_id: Optional[str] = Query(None, description="Hospital Group ID (default: '110' for MOH, '1' for Dev)"),
    module_key: str = Query("rms", description="Module key (e.g. 'rms')"),
    raw: bool = Query(False, description="Return raw unparsed hospital cache dictionary"),
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.fetch_feature_toggles(
            env_name=env_id,
            category=category,
            search=search,
            hospital_id=hospital_id,
            hospital_group_id=hospital_group_id,
            module_key=module_key,
            raw=raw
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/environments/{env_id}/feature-toggles",
    summary="Get environment feature toggles (POST)",
    description="POST alternative to query feature toggles with customizable request payload parameters."
)
def get_environment_feature_toggles_post(
    env_id: str,
    req: FeatureToggleRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.fetch_feature_toggles(
            env_name=env_id,
            category=req.category,
            search=req.search,
            hospital_id=req.hospital_id,
            hospital_group_id=req.hospital_group_id,
            module_key=req.module_key,
            raw=req.raw
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/feature-toggles/compare",
    summary="Compare live feature toggles between two environments",
    description="Fetches live feature toggles for two environments and produces a side-by-side comparison matrix showing matching, differing, and unique toggles."
)
def compare_environments_feature_toggles(
    req: FeatureToggleCompareRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.compare_feature_toggles(
            env1=req.env1,
            env2=req.env2,
            category=req.category,
            search=req.search,
            hospital_id1=req.hospital_id1,
            hospital_id2=req.hospital_id2
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get(
    "/environments/{env_id}/configs",
    summary="Get environment configuration cache (GET)",
    description="Queries the base-utility hospital cache API for arbitrary configuration keys across hospitals in an environment."
)
def get_environment_configs(
    env_id: str,
    keys: List[str] = Query(["FEATURE_TOGGLES"], description="Configuration keys to fetch"),
    hospital_group_id: Optional[str] = Query(None, description="Hospital Group ID"),
    hospital_id: Optional[str] = Query(None, description="Single hospital ID"),
    module_key: str = Query("rms", description="Module key"),
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.fetch_config_cache(
            env_name=env_id,
            keys=keys,
            hospital_group_id=hospital_group_id,
            hospital_ids=[hospital_id] if hospital_id else None,
            module_key=module_key
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/environments/{env_id}/configs",
    summary="Get environment configuration cache (POST)",
    description="POST alternative to query configuration cache with multiple hospital IDs and keys."
)
def post_environment_configs(
    env_id: str,
    req: ConfigCacheRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.fetch_config_cache(
            env_name=env_id,
            keys=req.keys,
            hospital_group_id=req.hospital_group_id,
            hospital_ids=req.hospital_ids,
            module_key=req.module_key,
            force_refresh_token=req.force_refresh_token
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post(
    "/config/hospitals/cache",
    summary="Base utility config cache proxy",
    description="Direct proxy endpoint matching the base-utility API signature with automatic Keycloak token injection and environment routing."
)
def proxy_config_cache(
    req: RawCacheProxyRequest,
    api_key: str = Depends(verify_api_key)
):
    try:
        return csi_service.fetch_config_cache(
            env_name=req.env,
            keys=req.keys,
            hospital_group_id=req.hospitalGroupId,
            hospital_ids=req.hospitalIds,
            module_key=req.moduleKey
        )
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


