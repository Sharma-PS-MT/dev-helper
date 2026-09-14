# CSI Helper MCP Server

A Model Context Protocol (MCP) server that connects AI assistants (Antigravity, Claude Code, Cursor) to the **CSI Helper REST API** for inspecting deployment environments, service modules, stream keys, and multi-environment version comparisons.

---

## Features

- **Environment Discovery**: Lists all 18 ArgoCD environments (DEV, PERF, VIDA UAT, HMG PROD, S1, S2, S3, KKUH, etc.).
- **Service Registry & Streams**: Queries microservices, repository mappings, and categorizes by stream key (`BM`, `PMS`, `MLM`, `RMS`, `EMPI`, `Integrations`).
- **Deployed Version Inspection**: Retrieves deployed container tags and sync/health states from live ArgoCD clusters via the CSI Helper API.
- **Side-by-Side Version Comparison**: Compares module versions between two or more environments and automatically detects version drift.

---

## Configuration

The server communicates with the CSI Helper REST API over HTTP and is configured via environment variables:

| Environment Variable | Description | Default |
|---|---|---|
| `CSI_HELPER_BASE_URL` | Base URL of CSI Helper API | `http://localhost:8000/api/v1` |
| `CSI_HELPER_API_KEY` | API Key for request authorization (dummy key accepted) | `dummy-api-key` |

---

## Build & Installation

```bash
cd D:\CSI\OTHER\csi-helper\csi-helper-mcp
npm install
npm run build
```

---

## Available Tools

1. **`get_env_list`**:
   - Lists all configured deployment environments.
   - Optional parameter: `search` (string).

2. **`get_module_list`**:
   - Lists registered CSI microservices and repositories.
   - Optional parameters: `stream` (string), `project` (string), `search` (string).

3. **`get_streams`**:
   - Lists all stream keys and module summaries under each stream.

4. **`get_modules_by_stream`**:
   - Lists all modules registered under a specific stream key.
   - Required parameter: `streamKey` (string, e.g. `"BM"`).

5. **`get_deployed_versions`**:
   - Queries deployed version(s) for module(s) across one or more environments.
   - Parameters: `environments` (string[]), `modules` (string[]), `stream` (string), `refresh` (boolean).

6. **`compare_deployed_versions`**:
   - Compares deployed versions across environments for a list of modules or an entire stream.
   - Parameters: `environments` (string[], e.g. `["dev", "vida-uat"]`), `modules` (string[]), `stream` (string), `refresh` (boolean).

---

## Connecting to Antigravity / Claude Code / Cursor

Add to your MCP configuration file (e.g. `~/.gemini/config/mcp_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "csi-helper": {
      "command": "node",
      "args": [
        "D:\\CSI\\OTHER\\csi-helper\\csi-helper-mcp\\dist\\index.js"
      ],
      "env": {
        "CSI_HELPER_BASE_URL": "http://localhost:8000/api/v1",
        "CSI_HELPER_API_KEY": "dummy-api-key"
      }
    }
  }
}
```
