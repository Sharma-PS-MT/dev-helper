"""
ArgoCD Proxy Router
Forwards ArgoCD API requests server-side to bypass browser CORS restrictions.
Angular → Python (this router) → ArgoCD cluster
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests
import urllib3

# Suppress InsecureRequestWarning for self-signed cluster certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter(prefix="/argocd", tags=["ArgoCD Proxy"])


class ArgocdSessionRequest(BaseModel):
    argocd_url: str     # e.g. https://argocd.example.com
    username: str
    password: str


class ArgocdAppsRequest(BaseModel):
    argocd_url: str
    token: str


@router.post("/session")
def argocd_session(req: ArgocdSessionRequest):
    """
    Proxy: POST to ArgoCD /api/v1/session server-side to bypass browser CORS.
    Returns the ArgoCD bearer token on success.
    """
    try:
        url = req.argocd_url.rstrip("/") + "/api/v1/session"
        resp = requests.post(
            url,
            json={"username": req.username, "password": req.password},
            timeout=15,
            verify=False  # Allow self-signed cluster certs
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach ArgoCD server: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="ArgoCD server timed out")


@router.post("/applications")
def argocd_applications(req: ArgocdAppsRequest):
    """
    Proxy: GET from ArgoCD /api/v1/applications server-side to bypass browser CORS.
    Accepts token + argocd_url in the body, returns the full application list.
    """
    try:
        url = req.argocd_url.rstrip("/") + "/api/v1/applications"
        resp = requests.get(
            url,
            headers={"Authorization": f"Bearer {req.token}"},
            timeout=30,
            verify=False  # Allow self-signed cluster certs
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach ArgoCD server: {e}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="ArgoCD server timed out")
