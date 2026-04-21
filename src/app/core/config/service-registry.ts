/**
* Service Registry
* ================
* Maps ArgoCD sync tags / image names → Bitbucket project + repository.
*
* Structure:
*   Each entry has a unique KEY (used internally only).
*   `project`    → Bitbucket project KEY (e.g. "BM")
*   `repository` → Bitbucket repo slug   (e.g. "csi-bm-invoice-java-service")
*   `aliases`    → All known service names / image substrings that identify this service.
*                  Matching is case-insensitive substring search.
*
* Add a new service by adding a new block — no other code changes needed.
*/

export interface ServiceConfig {
  /** Human-readable display name (optional, for UI use) */
  displayName?: string;
  /** Bitbucket project KEY */
  project: string;
  /** Bitbucket repository slug */
  repository: string;
  /**
   * All known names / image-name substrings that map to this service.
   * Matching is case-insensitive substring — so partial names work.
   */
  aliases: string[];
}

export const SERVICE_REGISTRY: Record<string, ServiceConfig> = {

};


// ─── Resolution API ────────────────────────────────────────────────────────────

export interface ResolvedService {
  key: string;
  project: string;
  repository: string;
  displayName: string;
}

/**
* Resolves an array of service name strings (1 or 2 items) to their
* corresponding Bitbucket project + repository.
*
* @param serviceNames  1 or 2 ArgoCD app / image names to resolve
* @param dynamicEntries Optional extra entries loaded from Firebase that are
*                       merged (and take priority) over the hardcoded registry.
*
* Rules:
*  - Returns `{ ok: true, result }` when all inputs map to the SAME project+repo.
*  - Returns `{ ok: false, error }` when inputs resolve to different projects.
*  - Returns `{ ok: false, error }` when no match is found.
*/
export function resolveServices(
  serviceNames: string[],
  dynamicEntries: import('../../core/services/auth-config.service').ServiceRegistryEntry[] = []
):
  | { ok: true; result: ResolvedService }
  | { ok: false; error: string } {
  if (!serviceNames.length) {
    return { ok: false, error: 'No service names provided.' };
  }

  // Find registry match for each input name
  const resolved = serviceNames.map(name => findMatch(name, dynamicEntries));

  // Check all resolved
  const unmatched = serviceNames.filter((_, i) => !resolved[i]);
  if (unmatched.length) {
    return {
      ok: false,
      error: `Could not resolve service(s): ${unmatched.join(', ')}. Please add them to the SERVICE_REGISTRY.`
    };
  }

  // For two inputs: both must map to the same registry entry
  if (resolved.length === 2 && resolved[0]!.key !== resolved[1]!.key) {
    return {
      ok: false,
      error: `Selected applications belong to different services ` +
        `("${resolved[0]!.displayName}" vs "${resolved[1]!.displayName}"). ` +
        `Please select applications from the same service.`
    };
  }

  return { ok: true, result: resolved[0]! };
}

/** Internal: find the first registry entry whose aliases match the given name.
 *  Dynamic entries (from Firebase) take priority over the hardcoded registry. */
function findMatch(
  name: string,
  dynamicEntries: import('../../core/services/auth-config.service').ServiceRegistryEntry[]
): ResolvedService | null {
  const lower = name.toLowerCase();

  // 1. Check dynamic (Firebase-managed) entries first
  for (const entry of dynamicEntries) {
    if (entry.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
      return {
        key: entry.key,
        project: entry.project,
        repository: entry.repository,
        displayName: entry.displayName || entry.key,
      };
    }
  }

  // 2. Fall back to hardcoded registry
  for (const key in SERVICE_REGISTRY) {
    const cfg = SERVICE_REGISTRY[key];
    if (cfg.aliases.some(alias => lower.includes(alias.toLowerCase()))) {
      return {
        key,
        project: cfg.project,
        repository: cfg.repository,
        displayName: cfg.displayName ?? key,
      };
    }
  }
  return null;
}
