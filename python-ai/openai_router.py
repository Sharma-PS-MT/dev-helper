"""
OpenAI Compatible Proxy Router
=============================
Forwards all OpenAI-compatible API calls (e.g. OpenRouter, LM Studio, Ollama, OpenAI)
server-side. Angular sends credentials + parameters in the POST body; this router
forwards them to the specified base URL.
"""

from typing import Any, Dict, List, Optional
import requests
import urllib3
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Suppress InsecureRequestWarning for local self-signed certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

router = APIRouter(prefix="/openai", tags=["OpenAI Proxy"])

class OpenAIModelsRequest(BaseModel):
    base_url: str
    api_key: str

class OpenAIChatRequest(BaseModel):
    base_url: str
    api_key: str
    model: str
    messages: List[Dict[str, str]]
    temperature: float = 0.3
    max_tokens: int = 4096

def _auth_header(api_key: str) -> str:
    """Build Authorization header ensuring exactly one 'Bearer' prefix."""
    key = api_key.strip()
    if key.lower().startswith("bearer "):
        return key
    return f"Bearer {key}"

@router.post("/models")
def openai_get_models(req: OpenAIModelsRequest):
    """
    Fetch models list from the OpenAI-compatible endpoint.
    """
    url = req.base_url.rstrip("/") + "/models"
    headers = {
        "Authorization": _auth_header(req.api_key),
        "Accept": "application/json",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=30, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Authentication failed - check your API key.")
        if not resp.ok:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach OpenAI-compatible server at {req.base_url}: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="OpenAI-compatible server timed out")

@router.post("/chat/completions")
def openai_chat_completions(req: OpenAIChatRequest):
    """
    Send chat completion request to the OpenAI-compatible endpoint.
    """
    url = req.base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": _auth_header(req.api_key),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    body = {
        "model": req.model,
        "messages": req.messages,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
    }
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=60, verify=False)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Authentication failed - check your API key.")
        if not resp.ok:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])
        return resp.json()
    except requests.exceptions.ConnectionError as exc:
        raise HTTPException(status_code=503, detail=f"Cannot reach OpenAI-compatible server at {req.base_url}: {exc}")
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="OpenAI-compatible server timed out")
