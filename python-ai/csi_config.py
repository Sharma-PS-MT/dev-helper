"""
CSI Helper Configuration
========================
Defines standard ArgoCD environments, service registry entries, and streams.
Supports environment variable overrides for secrets and URLs.
"""

import os
import time
import logging
import requests
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field

logger = logging.getLogger("csi_config")


class ArgoEnvConfig(BaseModel):
    id: str = Field(..., description="Unique environment identifier (e.g. dev, vida-uat)")
    name: str = Field(..., description="Human-readable environment name")
    url: str = Field(..., description="ArgoCD server URL")
    username: str = Field(..., description="ArgoCD login username")
    password: Optional[str] = Field(default=None, description="ArgoCD login password (hidden in public APIs)")
    aliases: List[str] = Field(default_factory=list, description="Aliases used for fuzzy matching")
    is_production: bool = Field(default=False, description="Whether this is a production environment")


class ServiceRegistryEntry(BaseModel):
    key: str = Field(..., description="Unique service key (e.g. BM_INVOICE_UI)")
    displayName: str = Field(..., description="Human-readable label shown in UI")
    project: str = Field(..., description="Bitbucket / Jira project key")
    repository: str = Field(..., description="Bitbucket repository slug")
    aliases: List[str] = Field(default_factory=list, description="Substrings or alternate names to match")
    stream: Optional[str] = Field(default=None, description="Stream / domain key (e.g. BM, PMS, MLM, RMS, EMPI)")


# ─────────────────────────────────────────────────────────────────────────────
# FIREBASE FIRESTORE CONSTANTS & PARSER
# ─────────────────────────────────────────────────────────────────────────────
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "dev-helper-87942")
FIREBASE_BASE_DOC_URL = f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/global"
FIREBASE_ARGOCD_URL = os.getenv("FIREBASE_ARGOCD_URL", f"{FIREBASE_BASE_DOC_URL}/argocd")
FIREBASE_KEYCLOAK_URL = os.getenv("FIREBASE_KEYCLOAK_URL", f"{FIREBASE_BASE_DOC_URL}/keycloak")
FIREBASE_SERVICE_REGISTRY_URL = os.getenv("FIREBASE_SERVICE_REGISTRY_URL", f"{FIREBASE_BASE_DOC_URL}/serviceRegistry")
SERVICES_CACHE_TTL = int(os.getenv("SERVICES_CACHE_TTL_SECONDS", "300"))  # 5 minutes


def _parse_firestore_value(val: Any) -> Any:
    """Helper to parse Firestore REST API typed values into Python primitives."""
    if not isinstance(val, dict):
        return val
    if "stringValue" in val:
        return val["stringValue"]
    elif "booleanValue" in val:
        return val["booleanValue"]
    elif "integerValue" in val:
        return int(val["integerValue"])
    elif "arrayValue" in val:
        return [_parse_firestore_value(v) for v in val["arrayValue"].get("values", [])]
    elif "mapValue" in val:
        return {k: _parse_firestore_value(v) for k, v in val["mapValue"].get("fields", {}).items()}
    return None


# ─────────────────────────────────────────────────────────────────────────────
# ARGO ENVIRONMENTS (Single Source of Truth: Firebase Firestore global/argocd)
# ─────────────────────────────────────────────────────────────────────────────
_ARGO_ENV_CACHE: List[ArgoEnvConfig] = []
_ARGO_ENV_CACHE_TIME: float = 0.0


def fetch_argo_envs_from_firebase() -> List[ArgoEnvConfig]:
    """
    Fetches the single source of truth for ArgoCD environments from Firebase Firestore.
    Document: global/argocd
    """
    import re
    try:
        resp = requests.get(FIREBASE_ARGOCD_URL, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            fields = data.get("fields", {})
            raw_envs = _parse_firestore_value(fields.get("argocdEnvs", {}))
            if isinstance(raw_envs, list):
                envs: List[ArgoEnvConfig] = []
                for e in raw_envs:
                    if not isinstance(e, dict):
                        continue
                    name = str(e.get("name", "")).strip()
                    raw_id = str(e.get("id", "")).strip()
                    url = str(e.get("url", "")).strip()
                    username = str(e.get("username", "")).strip()
                    password = str(e.get("password", "")).strip() if e.get("password") else None

                    # Generate clean slug id from name, e.g. "VIDA UAT (hmg-uat)" -> "vida-uat"
                    base_name = re.sub(r'\(.*?\)', '', name).strip()
                    clean_id = re.sub(r'[^a-z0-9]+', '-', base_name.lower()).strip('-')
                    env_id = clean_id or raw_id

                    aliases = [name.lower(), raw_id.lower()]
                    if clean_id and clean_id not in aliases:
                        aliases.append(clean_id)

                    # Extract parenthesized tags, e.g. (hmg-uat)
                    match = re.search(r'\((.*?)\)', name.lower())
                    if match:
                        p_slug = re.sub(r'[^a-z0-9]+', '-', match.group(1).strip()).strip('-')
                        if p_slug and p_slug not in aliases:
                            aliases.append(p_slug)
                        aliases.append(match.group(1).strip())

                    # Common abbreviations & aliases
                    if "vida-uat" in aliases:
                        for a in ["uat", "vidauat"]:
                            if a not in aliases:
                                aliases.append(a)
                    if "dev" in aliases:
                        for a in ["csi-dev", "development"]:
                            if a not in aliases:
                                aliases.append(a)
                    if "perf" in aliases:
                        for a in ["qa", "vida-qa"]:
                            if a not in aliases:
                                aliases.append(a)
                    if "hmg-prod" in aliases:
                        for a in ["hmg", "prod", "vida-prod"]:
                            if a not in aliases:
                                aliases.append(a)
                    if "s1-prod" in aliases:
                        for a in ["aseer", "aseer-prod", "s1prod"]:
                            if a not in aliases:
                                aliases.append(a)

                    is_prod = "prod" in name.lower() and "pre" not in name.lower()

                    envs.append(
                        ArgoEnvConfig(
                            id=env_id,
                            name=name,
                            url=url,
                            username=username,
                            password=password,
                            aliases=aliases,
                            is_production=is_prod
                        )
                    )
                logger.info(f"Loaded {len(envs)} ArgoCD environments from Firebase Firestore (global/argocd)")
                return envs
        logger.warning(f"Failed to load ArgoCD environments from Firebase: HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Error fetching ArgoCD environments from Firebase: {e}")
    return []


def get_all_environments(force_refresh: bool = False) -> List[ArgoEnvConfig]:
    """Returns all ArgoCD environments from Firebase Firestore (cached for SERVICES_CACHE_TTL seconds)."""
    global _ARGO_ENV_CACHE, _ARGO_ENV_CACHE_TIME
    now = time.time()
    if force_refresh or not _ARGO_ENV_CACHE or (now - _ARGO_ENV_CACHE_TIME > SERVICES_CACHE_TTL):
        fb_envs = fetch_argo_envs_from_firebase()
        if fb_envs:
            _ARGO_ENV_CACHE = fb_envs
            _ARGO_ENV_CACHE_TIME = now
    return _ARGO_ENV_CACHE


class DynamicEnvironmentList:
    """Dynamic proxy list resolving to Firebase Firestore single source of truth for environments."""
    def __iter__(self):
        return iter(get_all_environments())

    def __len__(self):
        return len(get_all_environments())

    def __getitem__(self, item):
        return get_all_environments()[item]

    def __contains__(self, item):
        return item in get_all_environments()

    def __repr__(self):
        return repr(get_all_environments())


# Backward-compatible proxy to single source of truth
ARGO_ENVIRONMENTS: Any = DynamicEnvironmentList()


# ─────────────────────────────────────────────────────────────────────────────
# SERVICE REGISTRY & STREAMS (Single Source of Truth: Firebase Firestore)
# ─────────────────────────────────────────────────────────────────────────────
_SERVICES_CACHE: List[ServiceRegistryEntry] = []
_SERVICES_CACHE_TIME: float = 0.0


def fetch_services_from_firebase() -> List[ServiceRegistryEntry]:
    """
    Fetches the single source of truth for the Service Registry from Firebase Firestore.
    Document: global/serviceRegistry
    """
    try:
        resp = requests.get(FIREBASE_SERVICE_REGISTRY_URL, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            fields = data.get("fields", {})
            entries_raw = fields.get("entries", {})
            parsed = _parse_firestore_value(entries_raw)
            if isinstance(parsed, list):
                services: List[ServiceRegistryEntry] = []
                for item in parsed:
                    if isinstance(item, dict) and "key" in item and "repository" in item:
                        services.append(
                            ServiceRegistryEntry(
                                key=str(item.get("key", "")),
                                displayName=str(item.get("displayName") or item.get("key", "")),
                                project=str(item.get("project", "")),
                                repository=str(item.get("repository", "")),
                                aliases=item.get("aliases", []) if isinstance(item.get("aliases"), list) else [],
                                stream=item.get("stream")
                            )
                        )
                logger.info(f"Loaded {len(services)} services from Firebase Firestore (single source of truth)")
                return services
        logger.warning(f"Failed to load services from Firebase Firestore: HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Error fetching services from Firebase Firestore: {e}")
    return []


def get_all_services(force_refresh: bool = False) -> List[ServiceRegistryEntry]:
    """
    Returns all registered services from Firebase Firestore (cached for SERVICES_CACHE_TTL seconds).
    Single source of truth shared with Angular UI.
    """
    global _SERVICES_CACHE, _SERVICES_CACHE_TIME
    now = time.time()
    if force_refresh or not _SERVICES_CACHE or (now - _SERVICES_CACHE_TIME > SERVICES_CACHE_TTL):
        fb_services = fetch_services_from_firebase()
        if fb_services:
            _SERVICES_CACHE = fb_services
            _SERVICES_CACHE_TIME = now
    return _SERVICES_CACHE


def refresh_services_cache() -> List[ServiceRegistryEntry]:
    """Explicitly invalidates and reloads service registry from Firebase."""
    return get_all_services(force_refresh=True)


class DynamicServiceList:
    """Dynamic proxy list resolving to Firebase Firestore single source of truth."""
    def __iter__(self):
        return iter(get_all_services())

    def __len__(self):
        return len(get_all_services())

    def __getitem__(self, item):
        return get_all_services()[item]

    def __contains__(self, item):
        return item in get_all_services()

    def __repr__(self):
        return repr(get_all_services())


# Backward-compatible proxy to single source of truth
KNOWN_SERVICES: Any = DynamicServiceList()


# ─────────────────────────────────────────────────────────────────────────────
# RESOLUTION HELPERS
# ─────────────────────────────────────────────────────────────────────────────
def resolve_environment(query: str) -> Optional[ArgoEnvConfig]:
    """Resolves an environment ID, name, or alias to an ArgoEnvConfig."""
    q = query.strip().lower()
    for env in ARGO_ENVIRONMENTS:
        if env.id.lower() == q or env.name.lower() == q:
            return env
        if any(alias.lower() == q for alias in env.aliases):
            return env
    # Substring match fallback
    for env in ARGO_ENVIRONMENTS:
        if q in env.id.lower() or q in env.name.lower():
            return env
    return None


def resolve_service(query: str) -> Optional[ServiceRegistryEntry]:
    """Resolves a service key, repository, or alias to a ServiceRegistryEntry using Firebase single source of truth."""
    q = query.strip().lower()
    services = get_all_services()
    for s in services:
        if s.key.lower() == q or s.repository.lower() == q:
            return s
        if any(alias.lower() == q for alias in s.aliases):
            return s
    # Substring match
    for s in services:
        if q in s.repository.lower() or any(q in alias.lower() for alias in s.aliases):
            return s
    return None


def get_all_streams() -> List[str]:
    """Returns unique sorted list of stream keys from Firebase single source of truth."""
    streams = {s.stream for s in get_all_services() if s.stream}
    return sorted(list(streams))


def get_services_by_stream(stream_key: str) -> List[ServiceRegistryEntry]:
    """Returns services under a specific stream key from Firebase single source of truth."""
    sk = stream_key.strip().lower()
    return [s for s in get_all_services() if s.stream and s.stream.strip().lower() == sk]


CSI_ROOT = os.getenv("CSI_WORKSPACE_ROOT", "D:\\CSI")


def find_local_repo_path(repo_name: str, project_hint: Optional[str] = None) -> Optional[str]:
    """Locates the local Git repository on disk under CSI_ROOT."""
    if project_hint:
        direct = os.path.join(CSI_ROOT, project_hint, repo_name)
        if os.path.isdir(direct):
            return direct

    # Try direct path
    direct_root = os.path.join(CSI_ROOT, repo_name)
    if os.path.isdir(direct_root):
        return direct_root

    # Candidate folders
    candidates = [
        "BM",
        "Patient Management System",
        "Medical Leave Management",
        "Resource Management System",
        "Integrations",
        "Java",
        "Pharmacy",
        "EMPI",
        "VIDAF",
        "Dental",
        "Automation",
        "OTHER"
    ]

    for folder in candidates:
        cand = os.path.join(CSI_ROOT, folder, repo_name)
        if os.path.isdir(cand):
            return cand

    # Fuzzy search
    for folder in candidates:
        folder_path = os.path.join(CSI_ROOT, folder)
        if not os.path.isdir(folder_path):
            continue
        try:
            for item in os.listdir(folder_path):
                sub = os.path.join(folder_path, item)
                if os.path.isdir(sub) and (item.lower() == repo_name.lower() or repo_name.lower() in item.lower()):
                    return sub
        except Exception:
            pass

    return None


# ─────────────────────────────────────────────────────────────────────────────
# KEYCLOAK & ENVIRONMENT UTILITY CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
class KeycloakEnvConfig(BaseModel):
    envName: str = Field(..., description="Unique environment identifier")
    baseUrl: str = Field(..., description="Keycloak base URL, e.g. https://apphiss1vi.moh.gov.sa/auth")
    realm: str = Field(..., description="Keycloak realm name")
    clientId: str = Field(default="app", description="Client ID used for OpenID Connect token grants")
    username: str = Field(..., description="Username for token acquisition")
    password: Optional[str] = Field(default=None, description="Password for token acquisition")
    defaultHospitalGroupId: str = Field(default="110", description="Default hospitalGroupId for base-utility cache API")
    defaultHospitalIds: List[str] = Field(
        default_factory=lambda: [
            "331", "343", "333", "344", "348", "337", "352", "330", "341", "349", "336", "357",
            "353", "342", "335", "347", "346", "355", "350", "340", "351", "332", "339", "345"
        ],
        description="Default hospitalIds list for base-utility cache API"
    )
    aliases: List[str] = Field(default_factory=list, description="Fuzzy matching aliases for this environment")


_KEYCLOAK_CACHE: Dict[str, Any] = {"envs": None, "timestamp": 0}


def fetch_keycloak_envs_from_firebase() -> List[KeycloakEnvConfig]:
    """
    Fetches the single source of truth for Keycloak environments from Firebase Firestore.
    Document: global/keycloak
    """
    try:
        resp = requests.get(FIREBASE_KEYCLOAK_URL, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            fields = data.get("fields", {})
            values = fields.get("keycloakEnvs", {}).get("arrayValue", {}).get("values", [])
            fetched: List[KeycloakEnvConfig] = []
            for v in values:
                f = v.get("mapValue", {}).get("fields", {})
                name = f.get("envName", {}).get("stringValue", "").strip()
                base = f.get("baseUrl", {}).get("stringValue", "").strip()
                realm = f.get("realm", {}).get("stringValue", "").strip()
                client = f.get("clientId", {}).get("stringValue", "app").strip()
                user = f.get("username", {}).get("stringValue", "").strip()
                pwd = f.get("password", {}).get("stringValue", "").strip() or None

                if name and base and realm:
                    aliases = [name.lower()]
                    if name == "alibaba-prod":
                        aliases.extend(["s1-prod", "s1", "aseer-prod", "aseer", "s1-uat", "alibaba"])
                    elif name == "csi-uat2":
                        aliases.extend(["uat", "vida-uat", "hmg-uat", "vidauat"])
                    elif name == "hmg-prod":
                        aliases.extend(["hmg", "vidaprod", "prod"])
                    elif name == "hmg-pre-prod":
                        aliases.extend(["preprod", "pre-prod", "vidapreprod"])
                    elif name == "perf":
                        aliases.extend(["qa", "vida-qa"])
                    elif name == "dev":
                        aliases.extend(["development", "csi-dev"])
                    elif name == "s2-prod":
                        aliases.extend(["s2", "s2-uat", "mch"])
                    elif name == "s3-prod":
                        aliases.extend(["s3", "jazan"])
                    elif name == "s3-uat":
                        aliases.extend(["s3u"])
                    elif name == "kfsh-prod":
                        aliases.extend(["kfsh", "kfshrc", "apphisw1vi"])

                    grp = "110" if "moh.gov.sa" in base else "1"
                    hosp_ids = ["1"] if grp == "1" else [
                        "331", "343", "333", "344", "348", "337", "352", "330", "341", "349", "336", "357",
                        "353", "342", "335", "347", "346", "355", "350", "340", "351", "332", "339", "345"
                    ]

                    fetched.append(
                        KeycloakEnvConfig(
                            envName=name,
                            baseUrl=base,
                            realm=realm,
                            clientId=client,
                            username=user,
                            password=pwd,
                            defaultHospitalGroupId=grp,
                            defaultHospitalIds=hosp_ids,
                            aliases=list(set(aliases))
                        )
                    )
            logger.info(f"Loaded {len(fetched)} Keycloak environments from Firebase Firestore (global/keycloak)")
            return fetched
        logger.warning(f"Failed to load Keycloak environments from Firebase: HTTP {resp.status_code}")
    except Exception as e:
        logger.warning(f"Error fetching Keycloak environments from Firebase: {e}")
    return []


def get_all_keycloak_envs(force_refresh: bool = False) -> List[KeycloakEnvConfig]:
    """Returns Keycloak environment configurations directly from Firebase Firestore."""
    now = time.time()
    if not force_refresh and _KEYCLOAK_CACHE["envs"] and (now - _KEYCLOAK_CACHE["timestamp"] < SERVICES_CACHE_TTL):
        return _KEYCLOAK_CACHE["envs"]

    envs = fetch_keycloak_envs_from_firebase()
    if envs:
        _KEYCLOAK_CACHE["envs"] = envs
        _KEYCLOAK_CACHE["timestamp"] = now
        return envs

    return _KEYCLOAK_CACHE["envs"] or []


def resolve_keycloak_env(env_name: str) -> Optional[KeycloakEnvConfig]:
    """Resolves an environment name or alias to its KeycloakEnvConfig."""
    query = env_name.strip().lower()
    envs = get_all_keycloak_envs()

    # 1. Exact match on envName
    for env in envs:
        if env.envName.lower() == query:
            return env

    # 2. Exact match in aliases
    for env in envs:
        if any(a.lower() == query for a in env.aliases):
            return env

    # 3. Substring match
    for env in envs:
        if query in env.envName.lower() or any(query in a.lower() for a in env.aliases):
            return env

    return None


def get_environment_app_base_url(env_config: KeycloakEnvConfig) -> str:
    """Derives the base application URL from the Keycloak baseUrl (e.g. strips /auth)."""
    base = env_config.baseUrl.strip().rstrip("/")
    if base.endswith("/auth"):
        base = base[:-5]
    return base


