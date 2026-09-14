/**
 * CSI Helper API Client
 * =====================
 * Communicates with the CSI Helper REST API.
 * Configured via environment variables:
 *   - CSI_HELPER_BASE_URL: Default 'http://localhost:8000/api/v1'
 *   - CSI_HELPER_API_KEY:  Default 'dummy-api-key'
 */

export interface EnvironmentInfo {
  id: string;
  name: string;
  url: string;
  aliases: string[];
  is_production: boolean;
}

export interface ModuleInfo {
  key: string;
  displayName: string;
  project: string;
  repository: string;
  aliases: string[];
  stream?: string;
}

export interface StreamSummary {
  stream: string;
  module_count: number;
  modules: string[];
}

export interface DeployedAppDetail {
  env_id: string;
  env_name: string;
  app_name: string;
  namespace: string;
  sync_status: string;
  health_status: string;
  sync_tag: string;
  last_synced_at: string;
  raw_images: string[];
}

export interface ModuleComparison {
  module_key: string;
  display_name: string;
  repository: string;
  project: string;
  stream?: string;
  has_difference: boolean;
  versions: Record<string, string>;
  deployments: Record<string, DeployedAppDetail | null>;
}

export interface ComparisonResponse {
  environments: Array<{ id: string; name: string; url: string }>;
  total_modules: number;
  differences_count: number;
  errors?: Record<string, string> | null;
  modules: ModuleComparison[];
}

export class CsiHelperApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    let url = baseUrl || process.env.CSI_HELPER_BASE_URL || "http://localhost:8000/api/v1";
    url = url.replace(/\/+$/, "");
    if (!url.endsWith("/api/v1")) {
      // If user passed root host (e.g. http://localhost:8000 or http://localhost:4201/python-ai)
      url = `${url}/api/v1`;
    }
    this.baseUrl = url;
    this.apiKey = apiKey || process.env.CSI_HELPER_API_KEY || "dummy-api-key";
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const targetUrl = `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
      ...(options.headers as Record<string, string> || {})
    };

    try {
      const resp = await fetch(targetUrl, {
        ...options,
        headers
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`CSI Helper API error (${resp.status} ${resp.statusText}): ${errText}`);
      }

      return (await resp.json()) as T;
    } catch (err: any) {
      if (err.cause || err.code === "ECONNREFUSED") {
        throw new Error(
          `Unable to connect to CSI Helper API at ${this.baseUrl}. ` +
          `Please make sure the backend is running (e.g. ./start.sh or uvicorn main:app on port 8000). Error: ${err.message}`
        );
      }
      throw err;
    }
  }

  /**
   * Retrieves list of all configured ArgoCD deployment environments.
   */
  async getEnvironments(search?: string): Promise<EnvironmentInfo[]> {
    const params = new URLSearchParams();
    if (search) params.append("search", search);
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request<EnvironmentInfo[]>(`/environments${query}`);
  }

  /**
   * Retrieves list of modules/services with optional filters.
   */
  async getModules(options: { stream?: string; project?: string; search?: string } = {}): Promise<ModuleInfo[]> {
    const params = new URLSearchParams();
    if (options.stream) params.append("stream", options.stream);
    if (options.project) params.append("project", options.project);
    if (options.search) params.append("search", options.search);
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request<ModuleInfo[]>(`/modules${query}`);
  }

  /**
   * Retrieves list of all stream keys and module summaries.
   */
  async getStreams(): Promise<StreamSummary[]> {
    return this.request<StreamSummary[]>("/streams");
  }

  /**
   * Retrieves all modules belonging to a specific stream key.
   */
  async getModulesByStream(streamKey: string): Promise<ModuleInfo[]> {
    return this.request<ModuleInfo[]>(`/streams/${encodeURIComponent(streamKey)}/modules`);
  }

  /**
   * Retrieves deployed versions for modules across environments.
   */
  async getDeployments(
    envs: string[],
    modules?: string[],
    stream?: string,
    refresh = false
  ): Promise<ComparisonResponse> {
    const params = new URLSearchParams();
    params.append("envs", envs.join(","));
    if (modules && modules.length > 0) params.append("modules", modules.join(","));
    if (stream) params.append("stream", stream);
    if (refresh) params.append("refresh", "true");

    return this.request<ComparisonResponse>(`/deployments?${params.toString()}`);
  }

  /**
   * Compares deployed versions across environments (POST).
   */
  async compareDeployments(
    environments: string[],
    modules?: string[],
    stream?: string,
    refresh = false
  ): Promise<ComparisonResponse> {
    return this.request<ComparisonResponse>("/deployments/compare", {
      method: "POST",
      body: JSON.stringify({
        environments,
        modules,
        stream,
        refresh
      })
    });
  }

  /**
   * Retrieves deployment details for a single module across environments.
   */
  async getSingleModuleDeployment(
    moduleKey: string,
    envs?: string[],
    refresh = false
  ): Promise<{ module: ModuleComparison; environments: any[]; errors?: any }> {
    const params = new URLSearchParams();
    if (envs && envs.length > 0) params.append("envs", envs.join(","));
    if (refresh) params.append("refresh", "true");
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request(`/deployments/modules/${encodeURIComponent(moduleKey)}${query}`);
  }

  /**
   * Performs release gap analysis between environments or specific refs.
   */
  async analyzeReleaseGap(options: {
    sourceEnv?: string;
    targetEnv?: string;
    modules?: string[];
    stream?: string;
    fromRef?: string;
    toRef?: string;
    refresh?: boolean;
  } = {}): Promise<any> {
    return this.request("/release-gap", {
      method: "POST",
      body: JSON.stringify({
        source_env: options.sourceEnv,
        target_env: options.targetEnv,
        modules: options.modules,
        stream: options.stream,
        from_ref: options.fromRef,
        to_ref: options.toRef,
        refresh: options.refresh || false
      })
    });
  }

  /**
   * Compares file changes, stats, commits, Jira tickets, and unified patch between refs or environments.
   */
  async compareDiff(options: {
    module: string;
    fromRef?: string;
    toRef?: string;
    sourceEnv?: string;
    targetEnv?: string;
    includePatch?: boolean;
    maxPatchLines?: number;
    refresh?: boolean;
  }): Promise<any> {
    return this.request("/diff/compare", {
      method: "POST",
      body: JSON.stringify({
        module: options.module,
        from_ref: options.fromRef,
        to_ref: options.toRef,
        source_env: options.sourceEnv,
        target_env: options.targetEnv,
        include_patch: options.includePatch !== false,
        max_patch_lines: options.maxPatchLines || 500,
        refresh: options.refresh || false
      })
    });
  }

  /**
   * Retrieves unified diff and commit details for a Pull Request.
   */
  async getPRDiff(options: {
    prId: number;
    module?: string;
    repoSlug?: string;
    projectKey?: string;
  }): Promise<any> {
    return this.request("/diff/pr", {
      method: "POST",
      body: JSON.stringify({
        pr_id: options.prId,
        module: options.module,
        repo_slug: options.repoSlug,
        project_key: options.projectKey
      })
    });
  }

  /**
   * Fetches live feature toggles for an environment via the CSI Helper REST API.
   */
  async getFeatureToggles(env: string, options: {
    category?: string;
    search?: string;
    hospitalId?: string;
    hospitalGroupId?: string;
    moduleKey?: string;
    raw?: boolean;
  } = {}): Promise<any> {
    const params = new URLSearchParams();
    if (options.category) params.set("category", options.category);
    if (options.search) params.set("search", options.search);
    if (options.hospitalId) params.set("hospital_id", options.hospitalId);
    if (options.hospitalGroupId) params.set("hospital_group_id", options.hospitalGroupId);
    if (options.moduleKey) params.set("module_key", options.moduleKey);
    if (options.raw) params.set("raw", "true");

    const query = params.toString();
    const endpoint = `/environments/${encodeURIComponent(env)}/feature-toggles${query ? `?${query}` : ""}`;
    return this.request(endpoint, { method: "GET" });
  }

  /**
   * Compares live feature toggles between two environments via the CSI Helper REST API.
   */
  async compareFeatureToggles(options: {
    env1: string;
    env2: string;
    category?: string;
    search?: string;
    hospitalId1?: string;
    hospitalId2?: string;
  }): Promise<any> {
    return this.request("/feature-toggles/compare", {
      method: "POST",
      body: JSON.stringify({
        env1: options.env1,
        env2: options.env2,
        category: options.category,
        search: options.search,
        hospital_id1: options.hospitalId1,
        hospital_id2: options.hospitalId2
      })
    });
  }

  /**
   * Queries arbitrary configuration keys across hospitals in an environment via the CSI Helper REST API.
   */
  async getConfigs(env: string, options: {
    keys?: string[];
    hospitalGroupId?: string;
    hospitalIds?: string[];
    moduleKey?: string;
    forceRefreshToken?: boolean;
  } = {}): Promise<any> {
    return this.request(`/environments/${encodeURIComponent(env)}/configs`, {
      method: "POST",
      body: JSON.stringify({
        keys: options.keys || ["FEATURE_TOGGLES"],
        hospital_group_id: options.hospitalGroupId,
        hospital_ids: options.hospitalIds,
        module_key: options.moduleKey || "rms",
        force_refresh_token: options.forceRefreshToken || false
      })
    });
  }

  /**
   * Direct proxy to the base-utility hospital cache API with automatic Keycloak token injection.
   */
  async proxyConfigCache(options: {
    env: string;
    hospitalGroupId?: string;
    hospitalIds?: string[];
    keys?: string[];
    moduleKey?: string;
  }): Promise<any> {
    return this.request("/config/hospitals/cache", {
      method: "POST",
      body: JSON.stringify({
        env: options.env,
        hospitalGroupId: options.hospitalGroupId,
        hospitalIds: options.hospitalIds,
        keys: options.keys || ["FEATURE_TOGGLES"],
        moduleKey: options.moduleKey || "rms"
      })
    });
  }
}

