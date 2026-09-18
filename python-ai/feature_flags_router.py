"""
Feature Flags Proxy Router
Forwards feature flags and token generation requests server-side
to avoid browser CORS and network issues.
Angular → Python (this router) → Keycloak / CSI Base Utility
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import requests
import urllib3

# Suppress InsecureRequestWarning for self-signed or internal SSL certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter(prefix="/feature-flags", tags=["Feature Flags Proxy"])


class KeycloakEnvModel(BaseModel):
    envName: Optional[str] = None
    baseUrl: str
    realm: str
    clientId: str
    appClientId: Optional[str] = None
    clientSecret: Optional[str] = None
    tenantId: Optional[str] = None
    username: str
    password: Optional[str] = None


class FetchFeatureFlagsRequest(BaseModel):
    config: KeycloakEnvModel
    token: Optional[str] = None


class FetchHospitalsRequest(BaseModel):
    config: KeycloakEnvModel
    token: Optional[str] = None


def _get_base_url_without_auth(raw_url: str) -> str:
    clean = (raw_url or "").strip().rstrip("/")
    if clean.lower().endswith("/auth"):
        clean = clean[:-5].rstrip("/")
    return clean


@router.post("/token")
def acquire_token(config: KeycloakEnvModel):
    """
    Acquires Keycloak Bearer token server-side.
    """
    try:
        base_url = config.baseUrl.rstrip("/")
        url = f"{base_url}/realms/{config.realm}/protocol/openid-connect/token"

        form_data = {
            "grant_type": "password",
            "client_id": config.clientId,
            "username": config.username,
        }
        if config.clientSecret:
            form_data["client_secret"] = config.clientSecret
        if config.password:
            form_data["password"] = config.password

        resp = requests.post(
            url,
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
            verify=False,
        )

        if not resp.ok:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Keycloak token error: {resp.text[:300]}",
            )

        return resp.json()
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach Keycloak server: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Keycloak server timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/query")
def get_feature_flags(req: FetchFeatureFlagsRequest):
    """
    Server-side proxy to fetch feature flags from CSI base-utility:
    GET {clean_baseUrl}/csi-api/csi-java-base-utility/base/feature-flags
    """
    config = req.config
    token = req.token

    # 1. If token is not provided, acquire it first
    if not token:
        token_res = acquire_token(config)
        token = token_res.get("access_token")
        if not token:
            raise HTTPException(
                status_code=400,
                detail="Token acquisition failed: no access_token in response",
            )

    # 2. Build target URL
    clean_base = _get_base_url_without_auth(config.baseUrl)
    endpoint = f"{clean_base}/csi-api/csi-java-base-utility/base/feature-flags"

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Authorization": f"Bearer {token}",
    }
    if config.tenantId:
        headers["x-group"] = str(config.tenantId).strip()

    try:
        resp = requests.get(
            endpoint,
            headers=headers,
            timeout=30,
            verify=False,
        )

        if not resp.ok:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"CSI feature-flags API error ({resp.status_code}): {resp.text[:300]}",
            )

        data = resp.json()
        raw_flags = data.get("flags") or []
        cleaned_flags = []
        for f in raw_flags:
            if isinstance(f, dict):
                cleaned_flags.append({
                    **f,
                    "flag": (f.get("flag") or "").strip()
                })

        return {"flags": cleaned_flags}
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach CSI API endpoint: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="CSI API endpoint timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/hospitals")
def get_hospitals(req: FetchHospitalsRequest):
    """
    Server-side proxy to fetch hospitals from CSI PMS/RMS masterdata:
    POST {clean_baseUrl}/csi-api/csi-pms-rms-masterdata/amd-masterdata/hospitals/general-details?fetchAll=true
    """
    config = req.config
    token = req.token

    if not token:
        token_res = acquire_token(config)
        token = token_res.get("access_token")
        if not token:
            raise HTTPException(
                status_code=400,
                detail="Token acquisition failed: no access_token in response",
            )

    clean_base = _get_base_url_without_auth(config.baseUrl)
    endpoint = f"{clean_base}/csi-api/csi-pms-rms-masterdata/amd-masterdata/hospitals/general-details?fetchAll=true"

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if config.tenantId:
        headers["x-group"] = str(config.tenantId).strip()

    try:
        resp = requests.post(
            endpoint,
            json=[],
            headers=headers,
            timeout=30,
            verify=False,
        )

        if not resp.ok:
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"CSI hospitals API error ({resp.status_code}): {resp.text[:300]}",
            )

        data = resp.json()
        raw_list = data if isinstance(data, list) else (
            data.get("data")
            or data.get("result")
            or data.get("hospitals")
            or data.get("content")
            or []
        )
        cleaned_hospitals = []
        for h in raw_list:
            if isinstance(h, dict):
                hid = h.get("id") or h.get("hospitalId") or h.get("hospital_id")
                hname = (
                    h.get("hospitalName")
                    or h.get("hospital_name")
                    or h.get("name")
                    or h.get("hospitalAlias")
                    or (f"Hospital #{hid}" if hid is not None else "")
                )
                if hid is not None:
                    try:
                        parsed_id = int(hid)
                    except (ValueError, TypeError):
                        parsed_id = hid
                    cleaned_hospitals.append({
                        "id": parsed_id,
                        "hospitalName": str(hname).strip()
                    })

        return {"hospitals": cleaned_hospitals}
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach CSI hospitals API endpoint: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="CSI hospitals API endpoint timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
