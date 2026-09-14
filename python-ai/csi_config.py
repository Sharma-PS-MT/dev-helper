"""
CSI Helper Configuration
========================
Defines standard ArgoCD environments, service registry entries, and streams.
Supports environment variable overrides for secrets and URLs.
"""

import os
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field


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
# ENVIRONMENTS
# ─────────────────────────────────────────────────────────────────────────────
ARGO_ENVIRONMENTS: List[ArgoEnvConfig] = [
    ArgoEnvConfig(
        id="dev",
        name="DEV",
        url=os.getenv("ARGO_DEV_URL", "https://dev-argocd.cloudsolutions.com.sa"),
        username=os.getenv("ARGO_DEV_USER", "admin"),
        password=os.getenv("ARGO_DEV_PASSWORD", "Argo@123"),
        aliases=["dev", "csi-dev", "development"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="perf",
        name="PERF",
        url=os.getenv("ARGO_PERF_URL", "https://argocd.cloudsolutions.com.sa"),
        username=os.getenv("ARGO_PERF_USER", "readonly"),
        password=os.getenv("ARGO_PERF_PASSWORD", "Readonly@123"),
        aliases=["perf", "qa", "vida-qa"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="vida-uat",
        name="VIDA UAT (hmg-uat)",
        url=os.getenv("ARGO_UAT_URL", "https://argocd-vidauat2.cloudsolutions.com.sa"),
        username=os.getenv("ARGO_UAT_USER", "supportAdmin"),
        password=os.getenv("ARGO_UAT_PASSWORD", "cG50DI@55@"),
        aliases=["uat", "vida-uat", "hmg-uat", "vidauat"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="hmg-prod",
        name="HMG PROD",
        url=os.getenv("ARGO_HMG_PROD_URL", "https://argo.hmg.com"),
        username=os.getenv("ARGO_HMG_PROD_USER", "supportuser"),
        password=os.getenv("ARGO_HMG_PROD_PASSWORD", "Support@hmg"),
        aliases=["hmg", "hmg-prod", "prod", "vida-prod"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="hmg-pre-prod",
        name="HMG PRE-PROD",
        url=os.getenv("ARGO_HMG_PREPROD_URL", "https://argo.hmg.com"),
        username=os.getenv("ARGO_HMG_PREPROD_USER", "supportuser"),
        password=os.getenv("ARGO_HMG_PREPROD_PASSWORD", "Support@hmg"),
        aliases=["hmg-pre-prod", "pre-prod", "preprod"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="s1-prod",
        name="S1 PROD",
        url=os.getenv("ARGO_S1_PROD_URL", "https://prod-aseer-argo.moh.gov.sa"),
        username=os.getenv("ARGO_S1_PROD_USER", "supportuser"),
        password=os.getenv("ARGO_S1_PROD_PASSWORD", "Support@aseer"),
        aliases=["s1-prod", "aseer-prod", "s1prod", "aseer"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="s1-uat",
        name="S1 UAT",
        url=os.getenv("ARGO_S1_UAT_URL", "https://aseer-argo.moh.gov.sa"),
        username=os.getenv("ARGO_S1_UAT_USER", "admin"),
        password=os.getenv("ARGO_S1_UAT_PASSWORD", "Argo@123"),
        aliases=["s1-uat", "aseer-uat", "s1uat"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="s2-uat",
        name="S2 UAT",
        url=os.getenv("ARGO_S2_UAT_URL", "http://argos2.moh.gov.sa"),
        username=os.getenv("ARGO_S2_UAT_USER", "readonly"),
        password=os.getenv("ARGO_S2_UAT_PASSWORD", "readonly@s2"),
        aliases=["s2-uat", "s2uat", "s2"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="s2-prod",
        name="S2 PROD",
        url=os.getenv("ARGO_S2_PROD_URL", "http://argos2-prod.moh.gov.sa"),
        username=os.getenv("ARGO_S2_PROD_USER", "readonly"),
        password=os.getenv("ARGO_S2_PROD_PASSWORD", "readonly@s2"),
        aliases=["s2-prod", "s2prod"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="s3-uat",
        name="S3 UAT",
        url=os.getenv("ARGO_S3_UAT_URL", "http://argos3.moh.gov.sa"),
        username=os.getenv("ARGO_S3_UAT_USER", "readonly"),
        password=os.getenv("ARGO_S3_UAT_PASSWORD", "readonly@s3"),
        aliases=["s3-uat", "s3uat", "s3"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="s3-prod",
        name="S3 PROD",
        url=os.getenv("ARGO_S3_PROD_URL", "http://argos3-prod.moh.gov.sa"),
        username=os.getenv("ARGO_S3_PROD_USER", "readonly"),
        password=os.getenv("ARGO_S3_PROD_PASSWORD", "readonly@s3"),
        aliases=["s3-prod", "s3prod"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="kkuh-prod",
        name="KKUH PROD",
        url=os.getenv("ARGO_KKUH_PROD_URL", "https://argocd.kkuh.med.sa"),
        username=os.getenv("ARGO_KKUH_PROD_USER", "readonly"),
        password=os.getenv("ARGO_KKUH_PROD_PASSWORD", "readonly@kkuh"),
        aliases=["kkuh-prod", "kkuh", "kkuhprod"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="kkuh-uat",
        name="KKUH UAT",
        url=os.getenv("ARGO_KKUH_UAT_URL", "https://argocd-uat.kkuh.med.sa"),
        username=os.getenv("ARGO_KKUH_UAT_USER", "readonly"),
        password=os.getenv("ARGO_KKUH_UAT_PASSWORD", "readonly@kkuh"),
        aliases=["kkuh-uat", "kkuhuat"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="kfsh-prod",
        name="KFSH PROD",
        url=os.getenv("ARGO_KFSH_PROD_URL", "https://argo.kfshrc.edu.sa"),
        username=os.getenv("ARGO_KFSH_PROD_USER", "supportuser"),
        password=os.getenv("ARGO_KFSH_PROD_PASSWORD", "Support@kfsh"),
        aliases=["kfsh-prod", "kfsh", "kfshrc"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="kauh-prod",
        name="KAUH PROD",
        url=os.getenv("ARGO_KAUH_PROD_URL", "https://argocd.kauh.med.sa"),
        username=os.getenv("ARGO_KAUH_PROD_USER", "readonly"),
        password=os.getenv("ARGO_KAUH_PROD_PASSWORD", "readonly@kauh"),
        aliases=["kauh-prod", "kauh", "kauhprod"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="kauh-uat",
        name="KAUH UAT",
        url=os.getenv("ARGO_KAUH_UAT_URL", "https://argocd-uat.kauh.med.sa"),
        username=os.getenv("ARGO_KAUH_UAT_USER", "readonly"),
        password=os.getenv("ARGO_KAUH_UAT_PASSWORD", "readonly@kauh"),
        aliases=["kauh-uat", "kauhuat"],
        is_production=False
    ),
    ArgoEnvConfig(
        id="nbcc-prod",
        name="NBCC PROD",
        url=os.getenv("ARGO_NBCC_PROD_URL", "https://argo.nbcc.com.sa"),
        username=os.getenv("ARGO_NBCC_PROD_USER", "supportuser"),
        password=os.getenv("ARGO_NBCC_PROD_PASSWORD", "Support@nbcc"),
        aliases=["nbcc-prod", "nbcc"],
        is_production=True
    ),
    ArgoEnvConfig(
        id="rsg-prod",
        name="RSG PROD",
        url=os.getenv("ARGO_RSG_PROD_URL", "https://argo.rsg.com.sa"),
        username=os.getenv("ARGO_RSG_PROD_USER", "supportuser"),
        password=os.getenv("ARGO_RSG_PROD_PASSWORD", "Support@rsg"),
        aliases=["rsg-prod", "rsg"],
        is_production=True
    ),
]


# ─────────────────────────────────────────────────────────────────────────────
# SERVICE REGISTRY & STREAMS
# ─────────────────────────────────────────────────────────────────────────────
KNOWN_SERVICES: List[ServiceRegistryEntry] = [
    ServiceRegistryEntry(
        key="BM_APPROVAL",
        project="BM",
        repository="csi-bm-approval-java-service",
        displayName="BM Approval Backend",
        aliases=[
            "csi-bm-approval-java-service",
            "prod-bmapprovaljava",
            "bmapprovaljava",
            "prod-billingapprovaljava",
            "approval-java",
            "approval-service"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_APPROVAL_UI",
        project="BM",
        repository="csi-bm-approval-ui",
        displayName="BM Approval UI",
        aliases=[
            "csi-bm-approval-ui",
            "bmapprovalui",
            "prod-billingapprovalui",
            "approval-ui"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_BILLING",
        project="BM",
        repository="csi-bm-billing-java-service",
        displayName="BM Billing Backend",
        aliases=[
            "csi-bm-billing-java-service",
            "prod-bmbillingjava",
            "bmbillingjava",
            "prod-billingjava",
            "billing-java",
            "billing-service"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_BILLING_UI",
        project="BM",
        repository="csi-bm-billing-ui",
        displayName="BM Billing UI",
        aliases=[
            "csi-bm-billing-ui",
            "prod-bmbillingui",
            "bmbillingui",
            "prod-billingmasterui",
            "billing-ui"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_INTE_BRIDGE",
        project="BM",
        repository="csi-bm-inte-bridge-java-service",
        displayName="BM Integration Bridge",
        aliases=[
            "csi-bm-inte-bridge-java-service",
            "prod-bmbridgejava",
            "bmbridgejava",
            "inte-bridge"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_INVOICE",
        project="BM",
        repository="csi-bm-invoice-java-service",
        displayName="BM Invoice Backend",
        aliases=[
            "csi-bm-invoice-java-service",
            "prod-bminvoicejava",
            "bminvoicejava",
            "prod-billinginvoicejava",
            "invoice-java",
            "invoice-service"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_INVOICE_UI",
        project="BM",
        repository="csi-bm-invoice-ui",
        displayName="BM Invoice UI",
        aliases=[
            "csi-bm-invoice-ui",
            "prod-bminvoiceui",
            "bminvoiceui",
            "prod-billinginvoiceui",
            "invoice-ui"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="BM_PROMOTION",
        project="BM",
        repository="csi-bm-promotion-java-service",
        displayName="BM Promotion Service",
        aliases=[
            "csi-bm-promotion-java-service",
            "promotion-service",
            "csi-bm-promotion"
        ],
        stream="BM"
    ),
    ServiceRegistryEntry(
        key="PMS_ADT_UI",
        project="Patient Management System",
        repository="csi-pms-adt-ui",
        displayName="PMS ADT UI",
        aliases=["csi-pms-adt-ui", "adt-ui", "prod-adtui", "adt"],
        stream="PMS"
    ),
    ServiceRegistryEntry(
        key="PMS_ADT_JAVA",
        project="Patient Management System",
        repository="csi-pms-adt-request-java-sev",
        displayName="PMS ADT Request Backend",
        aliases=["csi-pms-adt-request-java-sev", "adt-backend", "adt-service"],
        stream="PMS"
    ),
    ServiceRegistryEntry(
        key="MLM_UI",
        project="Medical Leave Management",
        repository="csi-mlm-ui",
        displayName="Medical Leave Management UI",
        aliases=["csi-mlm-ui", "mlm-ui", "mlm"],
        stream="MLM"
    ),
    ServiceRegistryEntry(
        key="RMS_MASTERDATA",
        project="Resource Management System",
        repository="csi-rms-masterdata-java-sev",
        displayName="RMS Masterdata Service",
        aliases=["csi-rms-masterdata-java-sev", "rms-masterdata", "masterdata"],
        stream="RMS"
    ),
    ServiceRegistryEntry(
        key="EMPI_API",
        project="EMPI",
        repository="csi-empi-api",
        displayName="EMPI API",
        aliases=["csi-empi-api", "empi-api", "empi"],
        stream="EMPI"
    ),
    ServiceRegistryEntry(
        key="EMPI_WEBUI",
        project="EMPI",
        repository="csi-empi-webui",
        displayName="EMPI Web UI",
        aliases=["csi-empi-webui", "empi-ui"],
        stream="EMPI"
    ),
    ServiceRegistryEntry(
        key="IE_GENERAL",
        project="Integrations",
        repository="csi-ie-general",
        displayName="Integrations General",
        aliases=["csi-ie-general", "ie-general", "integrations-general"],
        stream="Integrations"
    )
]


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
    """Resolves a service key, repository, or alias to a ServiceRegistryEntry."""
    q = query.strip().lower()
    for s in KNOWN_SERVICES:
        if s.key.lower() == q or s.repository.lower() == q:
            return s
        if any(alias.lower() == q for alias in s.aliases):
            return s
    # Substring match
    for s in KNOWN_SERVICES:
        if q in s.repository.lower() or any(q in alias.lower() for alias in s.aliases):
            return s
    return None


def get_all_streams() -> List[str]:
    """Returns unique sorted list of stream keys."""
    streams = {s.stream for s in KNOWN_SERVICES if s.stream}
    return sorted(list(streams))


def get_services_by_stream(stream_key: str) -> List[ServiceRegistryEntry]:
    """Returns services under a specific stream key (case-insensitive)."""
    sk = stream_key.strip().lower()
    return [s for s in KNOWN_SERVICES if s.stream and s.stream.strip().lower() == sk]


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


DEFAULT_KEYCLOAK_ENVIRONMENTS: List[KeycloakEnvConfig] = [
    KeycloakEnvConfig(
        envName="alibaba-prod",
        baseUrl="https://apphiss1vi.moh.gov.sa/auth",
        realm="apphiss1vi",
        clientId="app",
        username="azlee",
        password=os.getenv("KEYCLOAK_S1_PASSWORD", "SRE@support"),
        defaultHospitalGroupId="110",
        aliases=["s1-prod", "s1", "alibaba-prod", "aseer-prod", "aseer", "s1-uat", "alibaba"]
    ),
    KeycloakEnvConfig(
        envName="dev",
        baseUrl="https://dev.cloudsolutions.com.sa/auth",
        realm="dev",
        clientId="app",
        username="5547",
        password=os.getenv("KEYCLOAK_DEV_PASSWORD", "123"),
        defaultHospitalGroupId="1",
        defaultHospitalIds=["1"],
        aliases=["dev", "development", "csi-dev"]
    ),
    KeycloakEnvConfig(
        envName="perf",
        baseUrl="https://vidaqa.cloudsolutions.com.sa/auth",
        realm="vidaqa",
        clientId="app",
        username="5547",
        password=os.getenv("KEYCLOAK_PERF_PASSWORD", "123"),
        defaultHospitalGroupId="1",
        defaultHospitalIds=["1"],
        aliases=["perf", "qa", "vida-qa"]
    ),
    KeycloakEnvConfig(
        envName="hmg-prod",
        baseUrl="https://vidaprod.hmg.com/auth",
        realm="vidaprod",
        clientId="app",
        username="220116",
        password=os.getenv("KEYCLOAK_HMG_PROD_PASSWORD", "RPharmacy@1984"),
        defaultHospitalGroupId="1",
        defaultHospitalIds=["1"],
        aliases=["hmg-prod", "hmg", "vidaprod", "prod"]
    ),
    KeycloakEnvConfig(
        envName="hmg-pre-prod",
        baseUrl="https://vidapreprod.hmg.com/auth",
        realm="vidapreprod",
        clientId="app",
        username="7001",
        password=os.getenv("KEYCLOAK_HMG_PREPROD_PASSWORD", "123"),
        defaultHospitalGroupId="1",
        defaultHospitalIds=["1"],
        aliases=["hmg-pre-prod", "preprod", "pre-prod", "vidapreprod"]
    ),
    KeycloakEnvConfig(
        envName="csi-uat2",
        baseUrl="https://hmguat.cloudsolutions.com.sa/auth",
        realm="hmguat",
        clientId="app",
        username="600000",
        password=os.getenv("KEYCLOAK_UAT_PASSWORD", "123"),
        defaultHospitalGroupId="1",
        defaultHospitalIds=["1"],
        aliases=["csi-uat2", "uat", "vida-uat", "hmg-uat", "vidauat"]
    ),
    KeycloakEnvConfig(
        envName="s2-prod",
        baseUrl="https://apphiss2vi.moh.gov.sa/auth",
        realm="apphiss2vi",
        clientId="app",
        username="csl2",
        password=os.getenv("KEYCLOAK_S2_PASSWORD", "AppSup123456"),
        defaultHospitalGroupId="110",
        aliases=["s2-prod", "s2", "s2-uat", "mch"]
    ),
    KeycloakEnvConfig(
        envName="s3-prod",
        baseUrl="https://apphiss3vi.moh.gov.sa/auth",
        realm="apphiss3vi",
        clientId="app",
        username="L3",
        password=os.getenv("KEYCLOAK_S3_PASSWORD", "L3@123"),
        defaultHospitalGroupId="110",
        aliases=["s3-prod", "s3", "jazan"]
    ),
    KeycloakEnvConfig(
        envName="s3-uat",
        baseUrl="https://apphiss3viu.moh.gov.sa",
        realm="apphiss3viu",
        clientId="frontend-client",
        username="2303",
        password=os.getenv("KEYCLOAK_S3_UAT_PASSWORD", "123"),
        defaultHospitalGroupId="110",
        aliases=["s3-uat", "s3u"]
    ),
    KeycloakEnvConfig(
        envName="kfsh-prod",
        baseUrl="https://apphisw1vi.moh.gov.sa/auth",
        realm="apphisw1vi",
        clientId="app",
        username="SRE",
        password=os.getenv("KEYCLOAK_KFSH_PASSWORD", "SRE@123"),
        defaultHospitalGroupId="110",
        aliases=["kfsh-prod", "kfsh", "kfshrc", "apphisw1vi"]
    )
]

_FIRESTORE_CACHE: Dict[str, Any] = {"envs": None, "timestamp": 0}


def get_all_keycloak_envs() -> List[KeycloakEnvConfig]:
    """Returns Keycloak environment configurations, querying Firestore if available or using defaults."""
    import time
    now = time.time()
    if _FIRESTORE_CACHE["envs"] and (now - _FIRESTORE_CACHE["timestamp"] < 300):
        return _FIRESTORE_CACHE["envs"]

    # Try fetching fresh configs from Firebase REST API
    try:
        import urllib.request
        import json
        url = "https://firestore.googleapis.com/v1/projects/dev-helper-87942/databases/(default)/documents/global/keycloak"
        req = urllib.request.Request(url, headers={"User-Agent": "csi-helper/4.1.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                values = data.get("fields", {}).get("keycloakEnvs", {}).get("arrayValue", {}).get("values", [])
                fetched: List[KeycloakEnvConfig] = []
                for v in values:
                    f = v.get("mapValue", {}).get("fields", {})
                    name = f.get("envName", {}).get("stringValue", "")
                    base = f.get("baseUrl", {}).get("stringValue", "")
                    realm = f.get("realm", {}).get("stringValue", "")
                    client = f.get("clientId", {}).get("stringValue", "app")
                    user = f.get("username", {}).get("stringValue", "")
                    pwd = f.get("password", {}).get("stringValue", "")

                    if name and base and realm:
                        # Match aliases & hospital defaults from defaults if known
                        matched_def = next((d for d in DEFAULT_KEYCLOAK_ENVIRONMENTS if d.envName == name or name in d.aliases), None)
                        aliases = list(matched_def.aliases) if matched_def else [name.lower()]
                        if name.lower() not in aliases:
                            aliases.append(name.lower())
                        grp = matched_def.defaultHospitalGroupId if matched_def else ("110" if "moh.gov.sa" in base else "1")
                        hosp_ids = matched_def.defaultHospitalIds if matched_def else (["1"] if grp == "1" else [
                            "331", "343", "333", "344", "348", "337", "352", "330", "341", "349", "336", "357",
                            "353", "342", "335", "347", "346", "355", "350", "340", "351", "332", "339", "345"
                        ])

                        fetched.append(KeycloakEnvConfig(
                            envName=name,
                            baseUrl=base,
                            realm=realm,
                            clientId=client,
                            username=user,
                            password=pwd,
                            defaultHospitalGroupId=grp,
                            defaultHospitalIds=hosp_ids,
                            aliases=aliases
                        ))

                if fetched:
                    _FIRESTORE_CACHE["envs"] = fetched
                    _FIRESTORE_CACHE["timestamp"] = now
                    return fetched
    except Exception:
        pass

    # Fallback to seeded defaults
    _FIRESTORE_CACHE["envs"] = DEFAULT_KEYCLOAK_ENVIRONMENTS
    _FIRESTORE_CACHE["timestamp"] = now
    return DEFAULT_KEYCLOAK_ENVIRONMENTS


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


