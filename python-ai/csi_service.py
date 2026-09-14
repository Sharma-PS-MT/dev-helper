"""
CSI Service
===========
Handles ArgoCD session authentication, application retrieval,
deployed tag parsing, and multi-environment version comparison.
"""

import os
import re
import subprocess
import time
from typing import List, Dict, Optional, Any
import requests
import urllib3
from pydantic import BaseModel, Field

from csi_config import (
    ArgoEnvConfig,
    ServiceRegistryEntry,
    ARGO_ENVIRONMENTS,
    KNOWN_SERVICES,
    resolve_environment,
    resolve_service,
    get_services_by_stream,
    find_local_repo_path,
    KeycloakEnvConfig,
    resolve_keycloak_env,
    get_environment_app_base_url
)

# Suppress self-signed certificate warnings
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class DeployedAppInfo(BaseModel):
    env_id: str
    env_name: str
    app_name: str
    namespace: str
    sync_status: str
    health_status: str
    sync_tag: str
    last_synced_at: str
    raw_images: List[str] = Field(default_factory=list)


class ModuleDeploymentComparison(BaseModel):
    module_key: str
    display_name: str
    repository: str
    project: str
    stream: Optional[str] = None
    has_difference: bool = False
    versions: Dict[str, str] = Field(default_factory=dict, description="Map of env_id -> sync_tag")
    deployments: Dict[str, Optional[DeployedAppInfo]] = Field(
        default_factory=dict,
        description="Map of env_id -> detailed deployment info"
    )


class CommitDetail(BaseModel):
    hash: str
    short_hash: str
    author: str
    date: str
    message: str
    ticket_ids: List[str] = Field(default_factory=list)


class ReleaseGapResult(BaseModel):
    module_key: str
    display_name: str
    repository: str
    project: str
    stream: Optional[str] = None
    source_env: Optional[str] = None
    target_env: Optional[str] = None
    source_version: str
    target_version: str
    status: str = Field("IN_SYNC", description="IN_SYNC | AHEAD | BEHIND | DIVERGED | UNKNOWN")
    has_regression_risk: bool = Field(False, description="True if target has commits missing in source")
    forward_commits_count: int = 0
    reverse_commits_count: int = 0
    forward_commits: List[CommitDetail] = Field(default_factory=list)
    reverse_commits: List[CommitDetail] = Field(default_factory=list)
    all_ticket_ids: List[str] = Field(default_factory=list)
    repo_path: Optional[str] = None
    error: Optional[str] = None


class DiffFileStat(BaseModel):
    path: str
    insertions: int
    deletions: int
    status: str = "modified"


class DiffComparisonResponse(BaseModel):
    module_key: str
    display_name: str
    repository: str
    project: str
    from_ref: str
    to_ref: str
    total_files_changed: int
    total_insertions: int
    total_deletions: int
    changed_files: List[DiffFileStat] = Field(default_factory=list)
    commits: List[CommitDetail] = Field(default_factory=list)
    ticket_ids: List[str] = Field(default_factory=list)
    patch: Optional[str] = None
    patch_truncated: bool = False
    error: Optional[str] = None


class PRDiffResponse(BaseModel):
    project_key: str
    repo_slug: str
    pr_id: int
    title: Optional[str] = None
    author: Optional[str] = None
    source_branch: Optional[str] = None
    target_branch: Optional[str] = None
    state: Optional[str] = None
    diff: str
    commits: List[CommitDetail] = Field(default_factory=list)
    ticket_ids: List[str] = Field(default_factory=list)
    error: Optional[str] = None



class CsiService:
    def __init__(self):
        # Cache for tokens: cache_key -> {token, expires_at}
        self._session_cache: Dict[str, Dict[str, Any]] = {}
        # Cache for applications: env_id -> {apps, timestamp}
        self._apps_cache: Dict[str, Dict[str, Any]] = {}
        self._apps_cache_ttl: float = 300.0  # 5 minutes cache

    def get_session_token(self, env: ArgoEnvConfig) -> str:
        """Logs into ArgoCD and returns a valid Bearer token (cached for 1 hour)."""
        cache_key = f"{env.url}:{env.username}"
        now = time.time()

        if cache_key in self._session_cache:
            cached = self._session_cache[cache_key]
            if cached["expires_at"] > now:
                return cached["token"]

        if not env.url or not env.username or not env.password:
            raise ValueError(f"Missing ArgoCD credentials for environment '{env.name}' ({env.id})")

        url = env.url.rstrip("/") + "/api/v1/session"
        try:
            resp = requests.post(
                url,
                json={"username": env.username, "password": env.password},
                timeout=15,
                verify=False
            )
        except Exception as e:
            raise ConnectionError(f"Cannot connect to ArgoCD server for '{env.name}': {e}")

        if resp.status_code != 200:
            raise ValueError(f"ArgoCD login failed for '{env.name}': HTTP {resp.status_code} - {resp.text}")

        data = resp.json()
        token = data.get("token")
        if not token:
            raise ValueError(f"ArgoCD for '{env.name}' did not return a session token")

        self._session_cache[cache_key] = {
            "token": token,
            "expires_at": now + 3600
        }
        return token

    def fetch_applications_for_env(self, env: ArgoEnvConfig, refresh: bool = False) -> List[DeployedAppInfo]:
        """Fetches and parses all deployed applications for an environment."""
        now = time.time()
        if not refresh and env.id in self._apps_cache:
            entry = self._apps_cache[env.id]
            if now - entry["timestamp"] < self._apps_cache_ttl:
                return entry["apps"]

        token = self.get_session_token(env)
        url = env.url.rstrip("/") + "/api/v1/applications"

        try:
            resp = requests.get(
                url,
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
                verify=False
            )
        except Exception as e:
            raise ConnectionError(f"Failed to fetch applications from '{env.name}': {e}")

        if resp.status_code != 200:
            raise ValueError(f"Failed to fetch applications for '{env.name}': HTTP {resp.status_code} - {resp.text}")

        data = resp.json()
        items = data.get("items") or []

        # Apply environment-specific namespace filter
        env_upper = env.name.strip().upper()
        if env_upper == "HMG PROD":
            items = [a for a in items if a.get("spec", {}).get("destination", {}).get("namespace") == "vida-prod"]
        elif env_upper == "HMG PRE-PROD":
            items = [a for a in items if a.get("spec", {}).get("destination", {}).get("namespace") == "vida-uat"]

        parsed_apps = [self._parse_app(raw, env) for raw in items]

        self._apps_cache[env.id] = {
            "apps": parsed_apps,
            "timestamp": now
        }
        return parsed_apps

    def _parse_app(self, raw: Dict[str, Any], env: ArgoEnvConfig) -> DeployedAppInfo:
        """Parses a raw ArgoCD application object into DeployedAppInfo."""
        images: List[str] = raw.get("status", {}).get("summary", {}).get("images") or []
        extracted_sync_tag = raw.get("spec", {}).get("source", {}).get("targetRevision") or "HEAD"

        target_image = None
        for img in images:
            if "csi-data-migration-initiator" not in img:
                target_image = img
                break

        if target_image:
            parts = target_image.split(":")
            if len(parts) > 1:
                extracted_sync_tag = ":".join(parts[1:])

        return DeployedAppInfo(
            env_id=env.id,
            env_name=env.name,
            app_name=raw.get("metadata", {}).get("name") or "Unknown",
            namespace=raw.get("spec", {}).get("destination", {}).get("namespace") or "Unknown",
            sync_status=raw.get("status", {}).get("sync", {}).get("status") or "Unknown",
            health_status=raw.get("status", {}).get("health", {}).get("status") or "Unknown",
            sync_tag=extracted_sync_tag,
            last_synced_at=raw.get("status", {}).get("operationState", {}).get("finishedAt") or "",
            raw_images=images
        )

    def compare_deployments(
        self,
        env_ids: List[str],
        module_queries: Optional[List[str]] = None,
        stream_key: Optional[str] = None,
        refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Builds side-by-side version comparison matrix for requested environments and modules.
        """
        # 1. Resolve target environments
        envs: List[ArgoEnvConfig] = []
        errors: Dict[str, str] = {}
        for env_query in env_ids:
            found = resolve_environment(env_query)
            if found:
                envs.append(found)
            else:
                errors[env_query] = f"Environment '{env_query}' not recognized"

        if not envs:
            raise ValueError(f"No valid environments specified. Provided: {env_ids}")

        # 2. Determine target modules
        target_services: List[ServiceRegistryEntry] = []
        if module_queries:
            for q in module_queries:
                svc = resolve_service(q)
                if svc and svc not in target_services:
                    target_services.append(svc)
                elif not svc:
                    # Dynamically create fallback entry
                    target_services.append(
                        ServiceRegistryEntry(
                            key=q.upper().replace("-", "_"),
                            displayName=q,
                            project="Dynamic",
                            repository=q,
                            aliases=[q],
                            stream=stream_key
                        )
                    )
        elif stream_key:
            target_services = get_services_by_stream(stream_key)
            if not target_services:
                raise ValueError(f"No modules found under stream '{stream_key}'")
        else:
            target_services = list(KNOWN_SERVICES)

        # 3. Fetch applications for each environment
        env_apps_map: Dict[str, List[DeployedAppInfo]] = {}
        for env in envs:
            try:
                apps = self.fetch_applications_for_env(env, refresh=refresh)
                env_apps_map[env.id] = apps
            except Exception as e:
                errors[env.id] = str(e)
                env_apps_map[env.id] = []

        # 4. Group by module and compare versions across environments
        comparison_results: List[ModuleDeploymentComparison] = []
        diff_count = 0

        for svc in target_services:
            versions: Dict[str, str] = {}
            deployments: Dict[str, Optional[DeployedAppInfo]] = {}

            for env in envs:
                apps = env_apps_map.get(env.id, [])
                matched_app: Optional[DeployedAppInfo] = None

                # Matching logic: exact repo match, or alias substring match
                for app in apps:
                    app_lower = app.app_name.lower()
                    if app_lower == svc.repository.lower():
                        matched_app = app
                        break
                    if any(alias.lower() in app_lower for alias in svc.aliases):
                        matched_app = app
                        break
                    if svc.repository.lower() in app_lower:
                        matched_app = app
                        break

                if matched_app:
                    deployments[env.id] = matched_app
                    versions[env.id] = matched_app.sync_tag
                else:
                    deployments[env.id] = None
                    versions[env.id] = "NOT_DEPLOYED"

            # Determine whether versions differ across environments
            distinct_versions = {v for v in versions.values() if v != "NOT_DEPLOYED"}
            has_diff = len(distinct_versions) > 1 or ("NOT_DEPLOYED" in versions.values() and len(distinct_versions) >= 1)

            if has_diff:
                diff_count += 1

            comparison_results.append(
                ModuleDeploymentComparison(
                    module_key=svc.key,
                    display_name=svc.displayName,
                    repository=svc.repository,
                    project=svc.project,
                    stream=svc.stream,
                    has_difference=has_diff,
                    versions=versions,
                    deployments=deployments
                )
            )

        return {
            "environments": [{"id": e.id, "name": e.name, "url": e.url} for e in envs],
            "total_modules": len(comparison_results),
            "differences_count": diff_count,
            "errors": errors if errors else None,
            "modules": [comp.model_dump() for comp in comparison_results]
        }

    # ── Git & Local Repo Helpers ─────────────────────────────────────────────
    def _extract_tickets(self, text: str) -> List[str]:
        """Extracts unique Jira ticket IDs (e.g. V4-64224, BM-1234, CSI-567)."""
        pattern = r'\b([A-Z][A-Z0-9]+-\d+)\b'
        matches = re.findall(pattern, text)
        return sorted(list(set(matches)))

    def _run_git(self, repo_path: str, args: List[str]) -> str:
        """Executes a git command in the target repo directory."""
        if not os.path.isdir(repo_path):
            raise FileNotFoundError(f"Repository directory not found: {repo_path}")
        res = subprocess.run(
            ["git"] + args,
            cwd=repo_path,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or f"git command exited with code {res.returncode}")
        return res.stdout

    def _get_commits_between(self, repo_path: str, from_ref: str, to_ref: str) -> List[CommitDetail]:
        """Runs git log from_ref..to_ref and returns parsed CommitDetail list."""
        try:
            out = self._run_git(
                repo_path,
                ["log", "--pretty=format:%H|%an|%ad|%s", "--date=iso", f"{from_ref}..{to_ref}"]
            )
        except Exception:
            return []

        commits: List[CommitDetail] = []
        for line in out.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("|", 3)
            if len(parts) == 4:
                chash, author, date, message = parts
                commits.append(
                    CommitDetail(
                        hash=chash,
                        short_hash=chash[:8],
                        author=author,
                        date=date,
                        message=message,
                        ticket_ids=self._extract_tickets(message)
                    )
                )
        return commits

    def _get_diff_numstat(self, repo_path: str, from_ref: str, to_ref: str) -> Dict[str, Any]:
        """Runs git diff --numstat from_ref..to_ref and returns file stats."""
        try:
            out = self._run_git(repo_path, ["diff", "--numstat", f"{from_ref}..{to_ref}"])
        except Exception:
            return {"total_files_changed": 0, "total_insertions": 0, "total_deletions": 0, "changed_files": []}

        files: List[DiffFileStat] = []
        total_ins, total_del = 0, 0
        for line in out.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t", 2)
            if len(parts) == 3:
                ins = int(parts[0]) if parts[0].isdigit() else 0
                dele = int(parts[1]) if parts[1].isdigit() else 0
                total_ins += ins
                total_del += dele
                files.append(DiffFileStat(path=parts[2], insertions=ins, deletions=dele))
        return {
            "total_files_changed": len(files),
            "total_insertions": total_ins,
            "total_deletions": total_del,
            "changed_files": files
        }

    # ── Release Gap Analysis ─────────────────────────────────────────────────
    def analyze_release_gap(
        self,
        source_env: Optional[str] = None,
        target_env: Optional[str] = None,
        module_queries: Optional[List[str]] = None,
        stream_key: Optional[str] = None,
        from_ref: Optional[str] = None,
        to_ref: Optional[str] = None,
        refresh: bool = False
    ) -> Dict[str, Any]:
        """
        Analyzes release gap between environments or refs:
        - Forward commits: Commits in source not in target (new features/fixes being introduced).
        - Reverse commits: Commits in target not in source (regression risk / potential overwrite).
        - Jira ticket extraction across all commits.
        """
        # 1. Determine modules
        target_services: List[ServiceRegistryEntry] = []
        if module_queries:
            for q in module_queries:
                svc = resolve_service(q)
                if svc and svc not in target_services:
                    target_services.append(svc)
                elif not svc:
                    target_services.append(
                        ServiceRegistryEntry(
                            key=q.upper().replace("-", "_"),
                            displayName=q,
                            project="Dynamic",
                            repository=q,
                            aliases=[q],
                            stream=stream_key
                        )
                    )
        elif stream_key:
            target_services = get_services_by_stream(stream_key)
            if not target_services:
                raise ValueError(f"No modules found under stream '{stream_key}'")
        else:
            target_services = list(KNOWN_SERVICES)

        # 2. If environment-based, get deployed versions
        deployed_versions_map: Dict[str, Dict[str, str]] = {}
        if source_env and target_env:
            comp = self.compare_deployments(
                env_ids=[source_env, target_env],
                module_queries=[s.key for s in target_services],
                refresh=refresh
            )
            for m in comp.get("modules", []):
                deployed_versions_map[m["module_key"]] = m.get("versions", {})

        results: List[ReleaseGapResult] = []
        total_forward = 0
        total_reverse = 0
        all_tickets_set = set()

        for svc in target_services:
            src_version = from_ref
            tgt_version = to_ref

            if source_env and target_env:
                env_versions = deployed_versions_map.get(svc.key, {})
                s_env_obj = resolve_environment(source_env)
                t_env_obj = resolve_environment(target_env)
                s_id = s_env_obj.id if s_env_obj else source_env
                t_id = t_env_obj.id if t_env_obj else target_env
                src_version = env_versions.get(s_id, "NOT_DEPLOYED")
                tgt_version = env_versions.get(t_id, "NOT_DEPLOYED")

            src_version = src_version or "HEAD"
            tgt_version = tgt_version or "HEAD"

            repo_path = find_local_repo_path(svc.repository, svc.project)

            if src_version == tgt_version:
                results.append(
                    ReleaseGapResult(
                        module_key=svc.key,
                        display_name=svc.displayName,
                        repository=svc.repository,
                        project=svc.project,
                        stream=svc.stream,
                        source_env=source_env,
                        target_env=target_env,
                        source_version=src_version,
                        target_version=tgt_version,
                        status="IN_SYNC",
                        has_regression_risk=False,
                        repo_path=repo_path
                    )
                )
                continue

            if not repo_path or not os.path.isdir(repo_path):
                results.append(
                    ReleaseGapResult(
                        module_key=svc.key,
                        display_name=svc.displayName,
                        repository=svc.repository,
                        project=svc.project,
                        stream=svc.stream,
                        source_env=source_env,
                        target_env=target_env,
                        source_version=src_version,
                        target_version=tgt_version,
                        status="UNKNOWN",
                        error=f"Local git repository for '{svc.repository}' not found under CSI workspace."
                    )
                )
                continue

            # Forward commits: target..source (what source has that target does not)
            forward_commits = self._get_commits_between(repo_path, tgt_version, src_version)
            # Reverse commits: source..target (what target has that source does not)
            reverse_commits = self._get_commits_between(repo_path, src_version, tgt_version)

            f_count = len(forward_commits)
            r_count = len(reverse_commits)
            total_forward += f_count
            total_reverse += r_count

            has_risk = r_count > 0

            if f_count > 0 and r_count > 0:
                gap_status = "DIVERGED"
            elif f_count > 0:
                gap_status = "AHEAD"
            elif r_count > 0:
                gap_status = "BEHIND"
            else:
                gap_status = "IN_SYNC"

            module_tickets = set()
            for c in forward_commits + reverse_commits:
                module_tickets.update(c.ticket_ids)

            all_tickets_set.update(module_tickets)

            results.append(
                ReleaseGapResult(
                    module_key=svc.key,
                    display_name=svc.displayName,
                    repository=svc.repository,
                    project=svc.project,
                    stream=svc.stream,
                    source_env=source_env,
                    target_env=target_env,
                    source_version=src_version,
                    target_version=tgt_version,
                    status=gap_status,
                    has_regression_risk=has_risk,
                    forward_commits_count=f_count,
                    reverse_commits_count=r_count,
                    forward_commits=forward_commits,
                    reverse_commits=reverse_commits,
                    all_ticket_ids=sorted(list(module_tickets)),
                    repo_path=repo_path
                )
            )

        return {
            "source_env": source_env,
            "target_env": target_env,
            "total_modules": len(results),
            "modules_ahead": sum(1 for r in results if r.status == "AHEAD"),
            "modules_diverged": sum(1 for r in results if r.status == "DIVERGED"),
            "modules_in_sync": sum(1 for r in results if r.status == "IN_SYNC"),
            "total_forward_commits": total_forward,
            "total_reverse_commits": total_reverse,
            "has_regression_risk": total_reverse > 0,
            "all_ticket_ids": sorted(list(all_tickets_set)),
            "modules": [r.model_dump() for r in results]
        }

    # ── PR Diff & Branch Diff Comparison ─────────────────────────────────────
    def compare_diff(
        self,
        module_query: str,
        from_ref: Optional[str] = None,
        to_ref: Optional[str] = None,
        source_env: Optional[str] = None,
        target_env: Optional[str] = None,
        include_patch: bool = True,
        max_patch_lines: int = 500,
        refresh: bool = False
    ) -> DiffComparisonResponse:
        """
        Calculates file changes, insertions, deletions, commits, and unified patch
        between two refs/tags/branches or between two deployed environments.
        """
        svc = resolve_service(module_query)
        if not svc:
            svc = ServiceRegistryEntry(
                key=module_query.upper().replace("-", "_"),
                displayName=module_query,
                project="Dynamic",
                repository=module_query,
                aliases=[module_query]
            )

        repo_path = find_local_repo_path(svc.repository, svc.project)
        if not repo_path or not os.path.isdir(repo_path):
            raise FileNotFoundError(
                f"Local git repository for module '{svc.repository}' not found under CSI workspace."
            )

        # Resolve versions from environments if from_ref/to_ref not explicitly passed
        base_ref = from_ref
        target_ref = to_ref

        if (not base_ref or not target_ref) and source_env and target_env:
            comp = self.compare_deployments(
                env_ids=[source_env, target_env],
                module_queries=[svc.key],
                refresh=refresh
            )
            mods = comp.get("modules", [])
            if mods:
                v = mods[0].get("versions", {})
                s_obj = resolve_environment(source_env)
                t_obj = resolve_environment(target_env)
                base_ref = v.get(s_obj.id if s_obj else source_env, "HEAD")
                target_ref = v.get(t_obj.id if t_obj else target_env, "HEAD")

        if not base_ref or not target_ref:
            raise ValueError("Must specify either from_ref & to_ref, or source_env & target_env.")

        # 1. Diff numstat
        stats = self._get_diff_numstat(repo_path, base_ref, target_ref)

        # 2. Commits list
        commits = self._get_commits_between(repo_path, base_ref, target_ref)

        # 3. Tickets
        tickets = set()
        for c in commits:
            tickets.update(c.ticket_ids)

        # 4. Patch (unified diff)
        patch_text = None
        is_truncated = False
        if include_patch:
            try:
                raw_patch = self._run_git(repo_path, ["diff", f"{base_ref}..{target_ref}"])
                patch_lines = raw_patch.split("\n")
                if len(patch_lines) > max_patch_lines:
                    patch_text = "\n".join(patch_lines[:max_patch_lines]) + f"\n\n... [Diff truncated: {len(patch_lines) - max_patch_lines} more lines]"
                    is_truncated = True
                else:
                    patch_text = raw_patch
            except Exception as e:
                patch_text = f"Failed to generate unified diff: {e}"

        return DiffComparisonResponse(
            module_key=svc.key,
            display_name=svc.displayName,
            repository=svc.repository,
            project=svc.project,
            from_ref=base_ref,
            to_ref=target_ref,
            total_files_changed=stats["total_files_changed"],
            total_insertions=stats["total_insertions"],
            total_deletions=stats["total_deletions"],
            changed_files=stats["changed_files"],
            commits=commits,
            ticket_ids=sorted(list(tickets)),
            patch=patch_text,
            patch_truncated=is_truncated
        )

    def get_pr_diff(
        self,
        project_key: str,
        repo_slug: str,
        pr_id: int,
        base_url: Optional[str] = None,
        token: Optional[str] = None
    ) -> PRDiffResponse:
        """Fetches unified diff for a Pull Request from Bitbucket Server."""
        b_url = base_url or os.getenv("BITBUCKET_BASE_URL", "http://10.201.206.52:7990")
        b_token = token or os.getenv("BITBUCKET_TOKEN", "")

        url = b_url.rstrip("/") + f"/rest/api/1.0/projects/{project_key}/repos/{repo_slug}/pull-requests/{pr_id}"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json"
        }
        if b_token:
            headers["Authorization"] = f"Bearer {b_token}"

        title = None
        author = None
        source_b = None
        target_b = None
        pr_state = None
        commits: List[CommitDetail] = []
        ticket_ids_set = set()

        # 1. Fetch PR details
        try:
            r = requests.get(url, headers=headers, timeout=15, verify=False)
            if r.ok:
                pr_data = r.json()
                title = pr_data.get("title")
                author = pr_data.get("author", {}).get("user", {}).get("displayName")
                source_b = pr_data.get("fromRef", {}).get("displayId")
                target_b = pr_data.get("toRef", {}).get("displayId")
                pr_state = pr_data.get("state")
        except Exception:
            pass

        # 2. Fetch Commits
        try:
            commits_url = f"{url}/commits?limit=100"
            r_c = requests.get(commits_url, headers=headers, timeout=15, verify=False)
            if r_c.ok:
                c_data = r_c.json().get("values", [])
                for c in c_data:
                    c_hash = c.get("id", "")
                    c_msg = c.get("message", "")
                    t_ids = self._extract_tickets(c_msg)
                    ticket_ids_set.update(t_ids)
                    commits.append(
                        CommitDetail(
                            hash=c_hash,
                            short_hash=c_hash[:8],
                            author=c.get("author", {}).get("name", "Unknown"),
                            date=c.get("authorTimestamp", ""),
                            message=c_msg,
                            ticket_ids=t_ids
                        )
                    )
        except Exception:
            pass

        # 3. Fetch Diff
        diff_url = f"{url}/diff"
        diff_headers = {**headers, "Accept": "text/plain"}
        try:
            r_diff = requests.get(diff_url, headers=diff_headers, timeout=30, verify=False)
            if r_diff.ok:
                diff_text = r_diff.text
            else:
                diff_text = f"Bitbucket returned HTTP {r_diff.status_code}: {r_diff.text[:300]}"
        except Exception as e:
            diff_text = f"Error retrieving PR diff: {e}"

        return PRDiffResponse(
            project_key=project_key,
            repo_slug=repo_slug,
            pr_id=pr_id,
            title=title,
            author=author,
            source_branch=source_b,
            target_branch=target_b,
            state=pr_state,
            diff=diff_text,
            commits=commits,
            ticket_ids=sorted(list(ticket_ids_set))
        )

    # ─────────────────────────────────────────────────────────────────────────
    # KEYCLOAK TOKEN & BASE UTILITY CONFIG CACHE
    # ─────────────────────────────────────────────────────────────────────────
    _keycloak_token_cache: Dict[str, Dict[str, Any]] = {}

    def get_keycloak_token(self, env_name: str, force_refresh: bool = False) -> str:
        """Obtains an OpenID Connect Bearer token for the given environment via Keycloak."""
        env_config = resolve_keycloak_env(env_name)
        if not env_config:
            raise ValueError(f"No Keycloak configuration registered for environment '{env_name}'.")

        cache_key = env_config.envName
        now = time.time()
        cached = self._keycloak_token_cache.get(cache_key)

        if not force_refresh and cached and (now < cached.get("expires_at", 0) - 60):
            return cached["token"]

        token_url = f"{env_config.baseUrl.rstrip('/')}/realms/{env_config.realm}/protocol/openid-connect/token"
        form_data = {
            "grant_type": "password",
            "client_id": env_config.clientId,
            "username": env_config.username,
            "password": env_config.password or ""
        }

        try:
            resp = requests.post(
                token_url,
                data=form_data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15,
                verify=False
            )
            if not resp.ok:
                raise RuntimeError(
                    f"Keycloak token acquisition failed for '{env_config.envName}' (HTTP {resp.status_code}): {resp.text[:300]}"
                )
            token_data = resp.json()
            access_token = token_data.get("access_token")
            if not access_token:
                raise RuntimeError(f"Keycloak response missing 'access_token' for environment '{env_config.envName}'.")

            expires_in = token_data.get("expires_in", 3600)
            self._keycloak_token_cache[cache_key] = {
                "token": access_token,
                "expires_at": now + expires_in,
                "realm": env_config.realm
            }
            return access_token
        except requests.RequestException as e:
            raise RuntimeError(f"Network error contacting Keycloak at {token_url}: {e}")

    def get_environment_app_url(self, env_name: str) -> str:
        """Returns the derived application base URL for an environment (e.g. strips /auth)."""
        env_config = resolve_keycloak_env(env_name)
        if not env_config:
            raise ValueError(f"No Keycloak configuration registered for environment '{env_name}'.")
        return get_environment_app_base_url(env_config)

    def fetch_config_cache(
        self,
        env_name: str,
        keys: Optional[List[str]] = None,
        hospital_group_id: Optional[str] = None,
        hospital_ids: Optional[List[str]] = None,
        module_key: str = "rms",
        force_refresh_token: bool = False
    ) -> Dict[str, Any]:
        """Calls the base-utility hospital cache API for an environment."""
        env_config = resolve_keycloak_env(env_name)
        if not env_config:
            raise ValueError(f"No Keycloak configuration registered for environment '{env_name}'.")

        token = self.get_keycloak_token(env_name, force_refresh=force_refresh_token)
        app_base = get_environment_app_base_url(env_config)

        target_keys = keys or ["FEATURE_TOGGLES"]
        group_id = hospital_group_id or env_config.defaultHospitalGroupId
        hosp_ids = hospital_ids or env_config.defaultHospitalIds

        endpoint_url = f"{app_base}/csi-api/csi-java-base-utility/base/util/config/keys/hospitals/cache?lang=en&internationalization=true"
        payload = {
            "hospitalGroupId": str(group_id),
            "hospitalIds": [str(h) for h in hosp_ids],
            "keys": target_keys,
            "moduleKey": module_key
        }

        primary_hosp = hosp_ids[0] if hosp_ids else group_id
        headers = {
            "Authorization": f"bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/plain, */*",
            "x-group": str(group_id),
            "x-hospital": str(primary_hosp),
            "x-location": str(primary_hosp),
            "x-module": module_key,
            "x-user": "123"
        }

        try:
            resp = requests.post(endpoint_url, json=payload, headers=headers, timeout=20, verify=False)
            if resp.status_code == 401 and not force_refresh_token:
                # Token might have expired early on server, retry once with fresh token
                return self.fetch_config_cache(
                    env_name,
                    keys=keys,
                    hospital_group_id=hospital_group_id,
                    hospital_ids=hospital_ids,
                    module_key=module_key,
                    force_refresh_token=True
                )
            if not resp.ok:
                raise RuntimeError(
                    f"Base utility cache API returned HTTP {resp.status_code} on '{env_config.envName}': {resp.text[:300]}"
                )
            return resp.json()
        except requests.RequestException as e:
            raise RuntimeError(f"Failed to connect to base utility API at {endpoint_url}: {e}")

    def fetch_feature_toggles(
        self,
        env_name: str,
        category: Optional[str] = None,
        search: Optional[str] = None,
        hospital_id: Optional[str] = None,
        hospital_group_id: Optional[str] = None,
        module_key: str = "rms",
        raw: bool = False
    ) -> Dict[str, Any]:
        """Fetches and parses FEATURE_TOGGLES from the base-utility hospital cache API."""
        env_config = resolve_keycloak_env(env_name)
        if not env_config:
            raise ValueError(f"No Keycloak configuration registered for environment '{env_name}'.")

        cache_data = self.fetch_config_cache(
            env_name=env_name,
            keys=["FEATURE_TOGGLES"],
            hospital_group_id=hospital_group_id,
            hospital_ids=[hospital_id] if hospital_id else None,
            module_key=module_key
        )

        if raw:
            return {
                "environment": env_config.envName,
                "app_base_url": get_environment_app_base_url(env_config),
                "raw_response": cache_data
            }

        # Find target hospital in cache_data
        target_hosp = hospital_id
        if not target_hosp and isinstance(cache_data, dict) and len(cache_data) > 0:
            target_hosp = next(iter(cache_data.keys()))

        hosp_data = cache_data.get(target_hosp, {}) if isinstance(cache_data, dict) and target_hosp else {}
        feature_toggle_entry = hosp_data.get("FEATURE_TOGGLES", {}) if isinstance(hosp_data, dict) else {}
        config_value_str = feature_toggle_entry.get("configValue", "")

        import json
        toggles_by_category: Dict[str, Dict[str, Any]] = {}
        if config_value_str:
            try:
                parsed_json = json.loads(config_value_str)
                if isinstance(parsed_json, dict):
                    toggles_by_category = parsed_json
            except Exception:
                pass

        # Apply category filter if specified
        filtered_categories: Dict[str, Dict[str, Any]] = {}
        target_cat = category.strip().lower() if category and category.strip().lower() != "all" else None

        for cat_name, cat_dict in toggles_by_category.items():
            if target_cat and cat_name.lower() != target_cat:
                continue
            if not isinstance(cat_dict, dict):
                continue

            # Apply search filter if specified
            if search:
                q = search.strip().lower()
                matched_items = {k: v for k, v in cat_dict.items() if q in k.lower()}
                if matched_items:
                    filtered_categories[cat_name] = matched_items
            else:
                filtered_categories[cat_name] = cat_dict

        total_toggles = sum(len(d) for d in filtered_categories.values())

        return {
            "environment": env_config.envName,
            "app_base_url": get_environment_app_base_url(env_config),
            "hospital_id": target_hosp,
            "hospital_group_id": hospital_group_id or env_config.defaultHospitalGroupId,
            "module_key": module_key,
            "category_filter": category or "all",
            "search_query": search,
            "total_toggles": total_toggles,
            "categories": filtered_categories,
            "available_categories": list(toggles_by_category.keys()),
            "all_hospitals_available": list(cache_data.keys()) if isinstance(cache_data, dict) else []
        }

    def compare_feature_toggles(
        self,
        env1: str,
        env2: str,
        category: Optional[str] = None,
        search: Optional[str] = None,
        hospital_id1: Optional[str] = None,
        hospital_id2: Optional[str] = None
    ) -> Dict[str, Any]:
        """Compares live feature toggles between two environments."""
        res1 = self.fetch_feature_toggles(env1, category=category, search=search, hospital_id=hospital_id1)
        res2 = self.fetch_feature_toggles(env2, category=category, search=search, hospital_id=hospital_id2)

        cats1 = res1.get("categories", {})
        cats2 = res2.get("categories", {})

        all_categories = sorted(list(set(cats1.keys()) | set(cats2.keys())))

        matching: List[Dict[str, Any]] = []
        differing: List[Dict[str, Any]] = []
        only_in_env1: List[Dict[str, Any]] = []
        only_in_env2: List[Dict[str, Any]] = []

        for cat in all_categories:
            dict1 = cats1.get(cat, {})
            dict2 = cats2.get(cat, {})
            all_keys = sorted(list(set(dict1.keys()) | set(dict2.keys())))

            for k in all_keys:
                in_1 = k in dict1
                in_2 = k in dict2
                if in_1 and in_2:
                    val1 = dict1[k]
                    val2 = dict2[k]
                    if val1 == val2:
                        matching.append({"category": cat, "key": k, "value": val1})
                    else:
                        differing.append({
                            "category": cat,
                            "key": k,
                            "value_env1": val1,
                            "value_env2": val2
                        })
                elif in_1:
                    only_in_env1.append({"category": cat, "key": k, "value": dict1[k]})
                else:
                    only_in_env2.append({"category": cat, "key": k, "value": dict2[k]})

        return {
            "env1": res1.get("environment"),
            "env2": res2.get("environment"),
            "app_base_url_env1": res1.get("app_base_url"),
            "app_base_url_env2": res2.get("app_base_url"),
            "category_filter": category or "all",
            "search_query": search,
            "total_keys_compared": len(matching) + len(differing) + len(only_in_env1) + len(only_in_env2),
            "matching_count": len(matching),
            "differing_count": len(differing),
            "only_in_env1_count": len(only_in_env1),
            "only_in_env2_count": len(only_in_env2),
            "differing": differing,
            "only_in_env1": only_in_env1,
            "only_in_env2": only_in_env2,
            "matching": matching
        }


# Singleton service instance
csi_service = CsiService()

