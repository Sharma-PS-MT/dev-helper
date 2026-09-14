# CSI Helper REST API Documentation

The **CSI Helper REST API** exposes standard endpoints for managing and inspecting CSI environments, modules/services, stream keys, and multi-environment deployed application versions with automated version comparison and gap analysis.

---

## 1. Overview & Architecture

- **Backend Runtime**: FastAPI (Python 3.12)
- **Local Dev Direct URL**: `http://localhost:8000`
- **Docker / Angular Proxied URL**: `http://localhost:4201/python-ai`
- **API Version**: `v1` (Prefix: `/api/v1`)
- **Interactive Documentation**:
  - Swagger UI: `http://localhost:8000/docs`
  - ReDoc: `http://localhost:8000/redoc`
  - OpenAPI Specification: `http://localhost:8000/openapi.json`

---

## 2. Authentication

Requests to the CSI Helper API accept an API key via either:
1. **Header**: `X-API-Key: <your-api-key>`
2. **Authorization Header**: `Authorization: Bearer <your-api-key>`
3. **Query Parameter**: `?api_key=<your-api-key>`

> **Note**: For development and internal environments, dummy keys (e.g. `dummy-api-key` or `csi-dummy-key`) are accepted and not strictly enforced unless production security policy is activated.

---

## 3. Endpoints Reference

### 3.1 Get Environment List

Retrieves all configured deployment environments (e.g. DEV, PERF, VIDA UAT, HMG PROD, S1, S2, S3, KKUH, etc.).

- **Method**: `GET`
- **Path**: `/api/v1/environments`
- **Query Parameters**:
  - `search` *(optional, string)*: Filter environments by ID, name, or alias (e.g. `uat`, `prod`, `dev`).

#### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/environments?search=uat" \
  -H "X-API-Key: dummy-api-key"
```

#### Example Response (`200 OK`):
```json
[
  {
    "id": "vida-uat",
    "name": "VIDA UAT (hmg-uat)",
    "url": "https://argocd-vidauat2.cloudsolutions.com.sa",
    "aliases": ["uat", "vida-uat", "hmg-uat", "vidauat"],
    "is_production": false
  },
  {
    "id": "s1-uat",
    "name": "S1 UAT",
    "url": "https://aseer-argo.moh.gov.sa",
    "aliases": ["s1-uat", "aseer-uat", "s1uat"],
    "is_production": false
  },
  {
    "id": "s2-uat",
    "name": "S2 UAT",
    "url": "http://argos2.moh.gov.sa",
    "aliases": ["s2-uat", "s2uat", "s2"],
    "is_production": false
  }
]
```

---

### 3.2 Get Module List

Retrieves registered modules and microservices from the CSI service registry.

- **Method**: `GET`
- **Path**: `/api/v1/modules`
- **Query Parameters**:
  - `stream` *(optional, string)*: Filter by stream key (e.g. `BM`, `PMS`, `MLM`, `RMS`, `EMPI`, `Integrations`).
  - `project` *(optional, string)*: Filter by Bitbucket project (e.g. `BM`, `Patient Management System`).
  - `search` *(optional, string)*: Search across module key, display name, repository slug, or aliases.

#### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/modules?stream=BM" \
  -H "X-API-Key: dummy-api-key"
```

#### Example Response (`200 OK`):
```json
[
  {
    "key": "BM_APPROVAL_UI",
    "displayName": "BM Approval UI",
    "project": "BM",
    "repository": "csi-bm-approval-ui",
    "aliases": ["csi-bm-approval-ui", "bmapprovalui", "prod-billingapprovalui", "approval-ui"],
    "stream": "BM"
  },
  {
    "key": "BM_BILLING_UI",
    "displayName": "BM Billing UI",
    "project": "BM",
    "repository": "csi-bm-billing-ui",
    "aliases": ["csi-bm-billing-ui", "prod-bmbillingui", "bmbillingui", "prod-billingmasterui", "billing-ui"],
    "stream": "BM"
  },
  {
    "key": "BM_INVOICE_UI",
    "displayName": "BM Invoice UI",
    "project": "BM",
    "repository": "csi-bm-invoice-ui",
    "aliases": ["csi-bm-invoice-ui", "prod-bminvoiceui", "bminvoiceui", "prod-billinginvoiceui", "invoice-ui"],
    "stream": "BM"
  }
]
```

---

### 3.3 Get Stream List

Returns all known stream keys, total module counts, and the list of module display names under each stream.

- **Method**: `GET`
- **Path**: `/api/v1/streams`

#### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/streams" \
  -H "X-API-Key: dummy-api-key"
```

#### Example Response (`200 OK`):
```json
[
  {
    "stream": "BM",
    "module_count": 8,
    "modules": [
      "BM Approval Backend",
      "BM Approval UI",
      "BM Billing Backend",
      "BM Billing UI",
      "BM Integration Bridge",
      "BM Invoice Backend",
      "BM Invoice UI",
      "BM Promotion Service"
    ]
  },
  {
    "stream": "EMPI",
    "module_count": 2,
    "modules": ["EMPI API", "EMPI Web UI"]
  },
  {
    "stream": "PMS",
    "module_count": 2,
    "modules": ["PMS ADT UI", "PMS ADT Request Backend"]
  }
]
```

---

### 3.4 Get Modules under Stream Key

Returns full service registry details for all modules belonging to a specific stream.

- **Method**: `GET`
- **Path**: `/api/v1/streams/{stream_key}/modules`

#### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/streams/BM/modules" \
  -H "X-API-Key: dummy-api-key"
```

---

### 3.5 Get Deployed Versions & Version Comparison (GET)

Queries deployed versions for modules across one or more environments.

- **Method**: `GET`
- **Path**: `/api/v1/deployments`
- **Query Parameters**:
  - `envs` *(required, string)*: Comma-separated environment IDs (e.g. `dev,vida-uat`).
  - `modules` *(optional, string)*: Comma-separated module keys or repos (e.g. `csi-bm-approval-ui,csi-bm-billing-ui`).
  - `stream` *(optional, string)*: Filter by stream key (e.g. `BM`).
  - `refresh` *(optional, boolean)*: Set to `true` to bypass cache and query ArgoCD directly.

#### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/deployments?envs=dev,vida-uat&stream=BM" \
  -H "X-API-Key: dummy-api-key"
```

---

### 3.6 Compare Deployed Versions Across Environments (POST)

Performs a side-by-side version comparison across environments. Flags whether versions differ, shows exact image tags, and provides synchronization health.

- **Method**: `POST`
- **Path**: `/api/v1/deployments/compare`
- **Request Body**:
```json
{
  "environments": ["dev", "vida-uat"],
  "stream": "BM",
  "refresh": false
}
```

#### Example Response (`200 OK`):
```json
{
  "environments": [
    {"id": "dev", "name": "DEV", "url": "https://dev-argocd.cloudsolutions.com.sa"},
    {"id": "vida-uat", "name": "VIDA UAT (hmg-uat)", "url": "https://argocd-vidauat2.cloudsolutions.com.sa"}
  ],
  "total_modules": 8,
  "differences_count": 2,
  "errors": null,
  "modules": [
    {
      "module_key": "BM_APPROVAL_UI",
      "display_name": "BM Approval UI",
      "repository": "csi-bm-approval-ui",
      "project": "BM",
      "stream": "BM",
      "has_difference": true,
      "versions": {
        "dev": "V4.0.2609_W4-15750_dev",
        "vida-uat": "V4.0.2608_W3-15700_uat"
      },
      "deployments": {
        "dev": {
          "env_id": "dev",
          "env_name": "DEV",
          "app_name": "approval-ui",
          "namespace": "csi-dev",
          "sync_status": "Synced",
          "health_status": "Healthy",
          "sync_tag": "V4.0.2609_W4-15750_dev",
          "last_synced_at": "2026-09-12T04:12:00Z"
        },
        "vida-uat": {
          "env_id": "vida-uat",
          "env_name": "VIDA UAT (hmg-uat)",
          "app_name": "approval-ui",
          "namespace": "vida-uat",
          "sync_status": "Synced",
          "health_status": "Healthy",
          "sync_tag": "V4.0.2608_W3-15700_uat",
          "last_synced_at": "2026-09-11T18:30:00Z"
        }
      }
    }
  ]
}
```

---

### 3.7 Single Module Multi-Environment Deployment Lookup

- **Method**: `GET`
- **Path**: `/api/v1/deployments/modules/{module_key}`
- **Query Parameters**:
  - `envs` *(optional, string)*: Comma-separated environments to check (default: `dev,vida-uat,hmg-prod`).
  - `refresh` *(optional, boolean)*: Set to `true` to bypass cache.

#### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/deployments/modules/BM_APPROVAL_UI?envs=dev,vida-uat,hmg-prod" \
  -H "X-API-Key: dummy-api-key"
```

---

### 3.8 Release Gap Analysis

Performs release gap analysis between two environments or two tags/branches:
- **Forward Commits**: Commits present in source but missing in target (new features/fixes being introduced).
- **Reverse Commits**: Commits present in target but missing in source (regression alert: code in target that might be overwritten or lost).
- **Jira Tickets**: Extracts ticket keys across all commits.

- **Methods**: `POST /api/v1/release-gap` & `GET /api/v1/release-gap`
- **Request Body (POST)**:
```json
{
  "source_env": "dev",
  "target_env": "vida-uat",
  "stream": "BM"
}
```

#### Example Response (`200 OK`):
```json
{
  "source_env": "dev",
  "target_env": "vida-uat",
  "total_modules": 8,
  "modules_ahead": 4,
  "modules_diverged": 2,
  "modules_in_sync": 2,
  "total_forward_commits": 312,
  "total_reverse_commits": 14,
  "has_regression_risk": true,
  "all_ticket_ids": ["V4-64224", "BM-1892", "CSI-5420"],
  "modules": [
    {
      "module_key": "BM_APPROVAL_UI",
      "display_name": "BM Approval UI",
      "repository": "csi-bm-approval-ui",
      "source_version": "V4.0.2609_W4-15750_dev",
      "target_version": "V4.0.2607_W4-14713_prod",
      "status": "AHEAD",
      "has_regression_risk": false,
      "forward_commits_count": 224,
      "reverse_commits_count": 0,
      "forward_commits": [
        {
          "hash": "a0c25f35...",
          "short_hash": "a0c25f35",
          "author": "Pavini.W",
          "date": "2026-09-11 15:40:22 +0300",
          "message": "Pull request #1868: Feature/V4 64224 replace admissions endpoint",
          "ticket_ids": ["V4-64224"]
        }
      ],
      "reverse_commits": [],
      "all_ticket_ids": ["V4-64224"]
    }
  ]
}
```

Single module release gap lookup:
```bash
curl -X GET "http://localhost:8000/api/v1/release-gap/BM_APPROVAL_UI?source_env=dev&target_env=vida-uat" \
  -H "X-API-Key: dummy-api-key"
```

---

### 3.9 Git Diff & PR Comparison

#### A. Compare Diff Between Refs or Environments
Calculates file statistics (files changed, additions, deletions), commit logs, Jira tickets, and unified patch text.

- **Methods**: `POST /api/v1/diff/compare` & `GET /api/v1/diff/compare`
- **Request Body (POST)**:
```json
{
  "module": "BM_APPROVAL_UI",
  "from_ref": "V4.0.2607_W4-14713_prod",
  "to_ref": "V4.0.2609_W4-15750_dev",
  "include_patch": true,
  "max_patch_lines": 500
}
```
*(Alternatively, supply `source_env` and `target_env` to automatically resolve tags from ArgoCD)*

#### Example Response (`200 OK`):
```json
{
  "module_key": "BM_APPROVAL_UI",
  "display_name": "BM Approval UI",
  "repository": "csi-bm-approval-ui",
  "project": "BM",
  "from_ref": "V4.0.2607_W4-14713_prod",
  "to_ref": "V4.0.2609_W4-15750_dev",
  "total_files_changed": 64,
  "total_insertions": 4212,
  "total_deletions": 224,
  "changed_files": [
    {"path": "src/environments/environment.ts", "insertions": 31, "deletions": 2, "status": "modified"}
  ],
  "commits": [...],
  "ticket_ids": ["V4-64224"],
  "patch": "diff --git a/src/environments/environment.ts...",
  "patch_truncated": false
}
```

#### B. Pull Request Diff (Bitbucket)
Fetches unified diff and commit details for a Pull Request.

- **Methods**: `POST /api/v1/diff/pr` & `GET /api/v1/diff/pr`
- **Request Body (POST)**:
```json
{
  "module": "BM_APPROVAL_UI",
  "pr_id": 1868
}
```

---

### 3.5 Environment Feature Toggles & Configuration Cache (Live Base-Utility API)

Retrieves and compares live runtime feature toggles and hospital configuration cache values directly from microservices across deployment clusters.
The API automatically resolves Keycloak credentials, obtains OpenID Connect Bearer tokens, derives the application domain, and queries the base-utility endpoint:
`POST {env_base_url}/csi-api/csi-java-base-utility/base/util/config/keys/hospitals/cache?lang=en&internationalization=true`

#### A. Get Environment Feature Toggles
Fetches and unpacks `FEATURE_TOGGLES` into categorized dictionaries (`ops`, `release`, `experiment`, `permission`).

- **Methods**: `GET /api/v1/environments/{env_id}/feature-toggles` & `POST /api/v1/environments/{env_id}/feature-toggles`
- **Query / Body Parameters**:
  - `category` *(optional)*: Filter by category (`ops`, `release`, `experiment`, `permission`, `all`).
  - `search` *(optional)*: Case-insensitive search query matching toggle names.
  - `hospital_id` *(optional)*: Query a specific hospital ID (e.g. `"330"`, `"1"`). Defaults to first available.
  - `hospital_group_id` *(optional)*: Hospital group ID (default: `"110"` for MOH environments, `"1"` for Dev).
  - `module_key` *(optional)*: Module key for base utility (default: `"rms"`).
  - `raw` *(optional, boolean)*: Set to `true` to return the raw unparsed hospital cache map.

##### Example Request:
```bash
curl -X GET "http://localhost:8000/api/v1/environments/s1-prod/feature-toggles?category=ops&search=SMS" \
  -H "X-API-Key: dummy-api-key"
```

##### Example Response (`200 OK`):
```json
{
  "environment": "alibaba-prod",
  "app_base_url": "https://apphiss1vi.moh.gov.sa",
  "hospital_id": "350",
  "hospital_group_id": "110",
  "module_key": "rms",
  "category_filter": "ops",
  "search_query": "SMS",
  "total_toggles": 1,
  "categories": {
    "ops": {
      " enableNoShowLwbsSMS": true
    }
  },
  "available_categories": ["ops", "release", "experiment", "permission"],
  "all_hospitals_available": ["350", "340", "351", "352", "330", ...]
}
```

#### B. Compare Feature Toggles Across Environments
Performs side-by-side comparison between two environments (e.g. `dev` vs `s1-prod` or `s2-prod` vs `s3-prod`), highlighting differing toggles and unique toggles.

- **Method**: `POST /api/v1/feature-toggles/compare`
- **Request Body**:
```json
{
  "env1": "dev",
  "env2": "s1-prod",
  "category": "ops",
  "search": "SMS"
}
```

##### Example Response (`200 OK`):
```json
{
  "env1": "dev",
  "env2": "alibaba-prod",
  "app_base_url_env1": "https://dev.cloudsolutions.com.sa",
  "app_base_url_env2": "https://apphiss1vi.moh.gov.sa",
  "category_filter": "ops",
  "search_query": "SMS",
  "total_keys_compared": 3,
  "matching_count": 0,
  "differing_count": 0,
  "only_in_env1_count": 2,
  "only_in_env2_count": 1,
  "differing": [],
  "only_in_env1": [
    {"category": "ops", "key": "enableNoShowLwbsSMS", "value": true},
    {"category": "ops", "key": "enableSmsEmailConfigurationCR2267", "value": true}
  ],
  "only_in_env2": [
    {"category": "ops", "key": " enableNoShowLwbsSMS", "value": true}
  ],
  "matching": []
}
```

#### C. Get Environment Configurations Cache
Queries arbitrary configuration keys across hospitals in an environment.

- **Methods**: `GET /api/v1/environments/{env_id}/configs` & `POST /api/v1/environments/{env_id}/configs`
- **Request Body (POST)**:
```json
{
  "keys": ["FEATURE_TOGGLES"],
  "hospital_group_id": "110",
  "hospital_ids": ["330", "331"],
  "module_key": "rms"
}
```

#### D. Base Utility Cache Direct Proxy
Direct proxy endpoint conforming to the base-utility schema with automatic environment token injection.

- **Method**: `POST /api/v1/config/hospitals/cache`
- **Request Body**:
```json
{
  "env": "s1-prod",
  "hospitalGroupId": "110",
  "hospitalIds": ["330", "331"],
  "keys": ["FEATURE_TOGGLES"],
  "moduleKey": "rms"
}
```

---

## 4. MCP Server Integration (`csi-helper-mcp`)

The dedicated MCP server located in `csi-helper-mcp/` interfaces with these APIs over standard HTTP.
**Architecture Note**: The MCP server is a pure HTTP client calling the CSI Helper REST API. No credentials, tokens, or environment configs are stored in the MCP server.

### Environment Configuration:
- `CSI_HELPER_BASE_URL`: Base URL to the API (e.g. `http://localhost:8000/api/v1` or `http://localhost:4201/python-ai/api/v1`).
- `CSI_HELPER_API_KEY`: API key header value (default: `dummy-api-key`).

### MCP Tools Provided:
1. `get_env_list`: Calls `GET /api/v1/environments`
2. `get_module_list`: Calls `GET /api/v1/modules`
3. `get_streams`: Calls `GET /api/v1/streams`
4. `get_modules_by_stream`: Calls `GET /api/v1/streams/{stream_key}/modules`
5. `get_deployed_versions`: Calls `GET /api/v1/deployments`
6. `compare_deployed_versions`: Calls `POST /api/v1/deployments/compare`
7. `analyze_release_gap`: Calls `POST /api/v1/release-gap`
8. `compare_diff`: Calls `POST /api/v1/diff/compare`
9. `get_pr_diff`: Calls `POST /api/v1/diff/pr`
10. `get_env_feature_toggles`: Calls `GET /api/v1/environments/{env}/feature-toggles`
11. `compare_env_feature_toggles`: Calls `POST /api/v1/feature-toggles/compare`
12. `get_env_configs`: Calls `POST /api/v1/environments/{env}/configs`


