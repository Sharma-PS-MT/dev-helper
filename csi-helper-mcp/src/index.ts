#!/usr/bin/env node

/**
 * CSI Helper MCP Server
 * =====================
 * Model Context Protocol (MCP) server providing LLM tools to interact with
 * the CSI Helper REST API.
 *
 * Configured via:
 *   - CSI_HELPER_BASE_URL: Base URL of the CSI Helper API (default: http://localhost:8000/api/v1)
 *   - CSI_HELPER_API_KEY:  API key for request authorization (default: dummy-api-key)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from "@modelcontextprotocol/sdk/types.js";

import { CsiHelperApiClient } from "./api-client.js";

const client = new CsiHelperApiClient();

const TOOLS: Tool[] = [
  {
    name: "get_env_list",
    description: "Lists all configured ArgoCD deployment environments (DEV, PERF, VIDA UAT, HMG PROD, S1, S2, S3, KKUH, etc.) using the CSI Helper REST API.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Optional search query to filter environments by ID, name, or alias (e.g. 'uat', 'prod', 'dev')."
        }
      }
    }
  },
  {
    name: "get_module_list",
    description: "Lists all registered CSI microservices and modules from the service registry, with optional filters for stream, project, or search keywords.",
    inputSchema: {
      type: "object",
      properties: {
        stream: {
          type: "string",
          description: "Optional stream key filter (e.g. 'BM', 'PMS', 'MLM', 'RMS', 'EMPI', 'Integrations')."
        },
        project: {
          type: "string",
          description: "Optional project filter (e.g. 'BM', 'Patient Management System')."
        },
        search: {
          type: "string",
          description: "Optional search keyword to match against module key, display name, repository, or aliases."
        }
      }
    }
  },
  {
    name: "get_streams",
    description: "Lists all stream keys and summaries of modules registered under each stream.",
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "get_modules_by_stream",
    description: "Lists all modules registered under a specific stream key (e.g. 'BM', 'PMS', 'MLM', 'RMS', 'EMPI', 'Integrations').",
    inputSchema: {
      type: "object",
      properties: {
        streamKey: {
          type: "string",
          description: "The stream key (e.g. 'BM', 'PMS', 'MLM', 'RMS', 'EMPI', 'Integrations')."
        }
      },
      required: ["streamKey"]
    }
  },
  {
    name: "get_deployed_versions",
    description: "Queries deployed versions (tags, sync status, health status) for specified module(s) across one or more environments.",
    inputSchema: {
      type: "object",
      properties: {
        environments: {
          type: "array",
          items: { type: "string" },
          description: "Array of environment IDs or aliases (e.g. ['dev', 'vida-uat'])."
        },
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Optional array of module keys or repository names (e.g. ['csi-bm-approval-ui'])."
        },
        stream: {
          type: "string",
          description: "Optional stream key to filter modules (e.g. 'BM')."
        },
        refresh: {
          type: "boolean",
          description: "Set to true to bypass cache and fetch fresh application state from ArgoCD."
        }
      },
      required: ["environments"]
    }
  },
  {
    name: "compare_deployed_versions",
    description: "Performs side-by-side version comparison across environments for modules or streams, highlighting version differences, missing deployments, and sync states.",
    inputSchema: {
      type: "object",
      properties: {
        environments: {
          type: "array",
          items: { type: "string" },
          description: "Two or more environment IDs or aliases (e.g. ['dev', 'vida-uat'])."
        },
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of module keys or repository slugs to compare."
        },
        stream: {
          type: "string",
          description: "Optional stream key to compare all modules within that stream (e.g. 'BM')."
        },
        refresh: {
          type: "boolean",
          description: "Set to true to bypass cache and fetch fresh application state from ArgoCD."
        }
      },
      required: ["environments"]
    }
  },
  {
    name: "analyze_release_gap",
    description: "Analyzes release gap between environments or tags: finds forward commits (new code being released), reverse commits (regression risk/overwrites), and Jira tickets.",
    inputSchema: {
      type: "object",
      properties: {
        sourceEnv: {
          type: "string",
          description: "Source environment (e.g. 'dev')."
        },
        targetEnv: {
          type: "string",
          description: "Target environment (e.g. 'vida-uat' or 'hmg-prod')."
        },
        modules: {
          type: "array",
          items: { type: "string" },
          description: "Optional module key(s) or repository slug(s)."
        },
        stream: {
          type: "string",
          description: "Optional stream key (e.g. 'BM')."
        },
        fromRef: {
          type: "string",
          description: "Direct base branch/tag override."
        },
        toRef: {
          type: "string",
          description: "Direct target branch/tag override."
        },
        refresh: {
          type: "boolean",
          description: "Set to true to bypass ArgoCD cache."
        }
      }
    }
  },
  {
    name: "compare_diff",
    description: "Compares file diff, statistics, commits, Jira tickets, and unified patch between two git refs (branches, tags, commits) or between two deployment environments.",
    inputSchema: {
      type: "object",
      properties: {
        module: {
          type: "string",
          description: "Module key or repository slug (e.g. 'BM_APPROVAL_UI' or 'csi-bm-approval-ui')."
        },
        fromRef: {
          type: "string",
          description: "Base git ref/tag (e.g. 'V4.0.2607_W4-14713_prod')."
        },
        toRef: {
          type: "string",
          description: "Target git ref/tag (e.g. 'V4.0.2609_W4-15750_dev')."
        },
        sourceEnv: {
          type: "string",
          description: "Source environment (e.g. 'vida-uat') to auto-resolve base tag."
        },
        targetEnv: {
          type: "string",
          description: "Target environment (e.g. 'dev') to auto-resolve target tag."
        },
        includePatch: {
          type: "boolean",
          description: "Whether to return the unified diff patch text (default: true)."
        },
        maxPatchLines: {
          type: "number",
          description: "Maximum patch lines before truncating (default: 500)."
        },
        refresh: {
          type: "boolean",
          description: "Set to true to bypass ArgoCD cache."
        }
      },
      required: ["module"]
    }
  },
  {
    name: "get_pr_diff",
    description: "Retrieves unified diff, commits, and Jira tickets for a Bitbucket Pull Request.",
    inputSchema: {
      type: "object",
      properties: {
        prId: {
          type: "number",
          description: "Pull Request ID."
        },
        module: {
          type: "string",
          description: "Module key or repository slug."
        },
        repoSlug: {
          type: "string",
          description: "Bitbucket repository slug."
        },
        projectKey: {
          type: "string",
          description: "Bitbucket project key."
        }
      },
      required: ["prId"]
    }
  },
  {
    name: "get_env_feature_toggles",
    description: "Fetches and parses live feature toggles for an environment via the CSI Helper REST API (which queries the base-utility hospital cache). Supports category filtering ('ops', 'release', etc.) and keyword search.",
    inputSchema: {
      type: "object",
      properties: {
        env: {
          type: "string",
          description: "Environment identifier or alias (e.g. 's1-prod', 'dev', 's2-prod', 's3-prod', 'hmg-prod')."
        },
        category: {
          type: "string",
          description: "Optional category filter ('ops', 'release', 'experiment', 'permission', 'all')."
        },
        search: {
          type: "string",
          description: "Optional search query to match against toggle names."
        },
        hospitalId: {
          type: "string",
          description: "Optional specific hospital ID."
        },
        hospitalGroupId: {
          type: "string",
          description: "Optional hospital group ID (default: '110' for MOH, '1' for Dev)."
        },
        moduleKey: {
          type: "string",
          description: "Optional module key (default: 'rms')."
        },
        raw: {
          type: "boolean",
          description: "Set to true to return the raw unparsed hospital cache map."
        }
      },
      required: ["env"]
    }
  },
  {
    name: "compare_env_feature_toggles",
    description: "Compares live feature toggles between two environments (e.g. 'dev' vs 's1-prod') via the CSI Helper REST API, identifying matching, differing, and missing toggles.",
    inputSchema: {
      type: "object",
      properties: {
        env1: {
          type: "string",
          description: "First environment (e.g. 'dev', 's1-prod', 's2-prod')."
        },
        env2: {
          type: "string",
          description: "Second environment (e.g. 's1-prod', 's3-prod')."
        },
        category: {
          type: "string",
          description: "Optional category filter ('ops', 'release', 'experiment', 'permission', 'all')."
        },
        search: {
          type: "string",
          description: "Optional search filter for toggle key."
        },
        hospitalId1: {
          type: "string",
          description: "Optional hospital ID for env1."
        },
        hospitalId2: {
          type: "string",
          description: "Optional hospital ID for env2."
        }
      },
      required: ["env1", "env2"]
    }
  },
  {
    name: "get_env_configs",
    description: "Queries live configuration cache across hospitals in an environment for arbitrary config keys (default: ['FEATURE_TOGGLES']) via the CSI Helper REST API.",
    inputSchema: {
      type: "object",
      properties: {
        env: {
          type: "string",
          description: "Environment identifier or alias (e.g. 's1-prod', 'dev', 's2-prod')."
        },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Configuration keys to query (default: ['FEATURE_TOGGLES'])."
        },
        hospitalGroupId: {
          type: "string",
          description: "Optional hospital group ID."
        },
        hospitalIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of hospital IDs."
        },
        moduleKey: {
          type: "string",
          description: "Optional module key (default: 'rms')."
        },
        forceRefreshToken: {
          type: "boolean",
          description: "Set to true to bypass Keycloak token cache."
        }
      },
      required: ["env"]
    }
  }
];

const server = new Server(
  {
    name: "csi-helper-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Register Tool List handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Register Tool Call handler
server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_env_list": {
        const search = args?.search as string | undefined;
        const envs = await client.getEnvironments(search);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(envs, null, 2)
            }
          ]
        };
      }

      case "get_module_list": {
        const stream = args?.stream as string | undefined;
        const project = args?.project as string | undefined;
        const search = args?.search as string | undefined;
        const modules = await client.getModules({ stream, project, search });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(modules, null, 2)
            }
          ]
        };
      }

      case "get_streams": {
        const streams = await client.getStreams();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(streams, null, 2)
            }
          ]
        };
      }

      case "get_modules_by_stream": {
        const streamKey = (args?.streamKey as string) || "";
        const modules = await client.getModulesByStream(streamKey);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(modules, null, 2)
            }
          ]
        };
      }

      case "get_deployed_versions": {
        const envs = (args?.environments as string[]) || [];
        const modules = args?.modules as string[] | undefined;
        const stream = args?.stream as string | undefined;
        const refresh = Boolean(args?.refresh);

        const res = await client.getDeployments(envs, modules, stream, refresh);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "compare_deployed_versions": {
        const envs = (args?.environments as string[]) || [];
        const modules = args?.modules as string[] | undefined;
        const stream = args?.stream as string | undefined;
        const refresh = Boolean(args?.refresh);

        const res = await client.compareDeployments(envs, modules, stream, refresh);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "analyze_release_gap": {
        const sourceEnv = args?.sourceEnv as string | undefined;
        const targetEnv = args?.targetEnv as string | undefined;
        const modules = args?.modules as string[] | undefined;
        const stream = args?.stream as string | undefined;
        const fromRef = args?.fromRef as string | undefined;
        const toRef = args?.toRef as string | undefined;
        const refresh = Boolean(args?.refresh);

        const res = await client.analyzeReleaseGap({
          sourceEnv,
          targetEnv,
          modules,
          stream,
          fromRef,
          toRef,
          refresh
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "compare_diff": {
        const module = args?.module as string;
        const fromRef = args?.fromRef as string | undefined;
        const toRef = args?.toRef as string | undefined;
        const sourceEnv = args?.sourceEnv as string | undefined;
        const targetEnv = args?.targetEnv as string | undefined;
        const includePatch = args?.includePatch !== false;
        const maxPatchLines = typeof args?.maxPatchLines === "number" ? args.maxPatchLines : 500;
        const refresh = Boolean(args?.refresh);

        const res = await client.compareDiff({
          module,
          fromRef,
          toRef,
          sourceEnv,
          targetEnv,
          includePatch,
          maxPatchLines,
          refresh
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "get_pr_diff": {
        const prId = Number(args?.prId);
        const module = args?.module as string | undefined;
        const repoSlug = args?.repoSlug as string | undefined;
        const projectKey = args?.projectKey as string | undefined;

        const res = await client.getPRDiff({
          prId,
          module,
          repoSlug,
          projectKey
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "get_env_feature_toggles": {
        const env = String(args?.env || "");
        const category = args?.category as string | undefined;
        const search = args?.search as string | undefined;
        const hospitalId = args?.hospitalId as string | undefined;
        const hospitalGroupId = args?.hospitalGroupId as string | undefined;
        const moduleKey = args?.moduleKey as string | undefined;
        const raw = Boolean(args?.raw);

        const res = await client.getFeatureToggles(env, {
          category,
          search,
          hospitalId,
          hospitalGroupId,
          moduleKey,
          raw
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "compare_env_feature_toggles": {
        const env1 = String(args?.env1 || "");
        const env2 = String(args?.env2 || "");
        const category = args?.category as string | undefined;
        const search = args?.search as string | undefined;
        const hospitalId1 = args?.hospitalId1 as string | undefined;
        const hospitalId2 = args?.hospitalId2 as string | undefined;

        const res = await client.compareFeatureToggles({
          env1,
          env2,
          category,
          search,
          hospitalId1,
          hospitalId2
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      case "get_env_configs": {
        const env = String(args?.env || "");
        const keys = args?.keys as string[] | undefined;
        const hospitalGroupId = args?.hospitalGroupId as string | undefined;
        const hospitalIds = args?.hospitalIds as string[] | undefined;
        const moduleKey = args?.moduleKey as string | undefined;
        const forceRefreshToken = Boolean(args?.forceRefreshToken);

        const res = await client.getConfigs(env, {
          keys,
          hospitalGroupId,
          hospitalIds,
          moduleKey,
          forceRefreshToken
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(res, null, 2)
            }
          ]
        };
      }

      default:
        throw new Error(`Unknown tool name: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${error.message}`
        }
      ]
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("CSI Helper MCP Server running on stdio transport");
}

main().catch(err => {
  console.error("Fatal error starting CSI Helper MCP server:", err);
  process.exit(1);
});
