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

  // ── Billing Management ──────────────────────────────────────────────────────

  BM_INVOICE: {
    displayName: 'BM Invoice',
    project: 'BM',
    repository: 'csi-bm-invoice-java-service',
    aliases: [
      'csi-bm-invoice-java-service',
      'prod-bminvoicejava',
      'bminvoicejava',
    ]
  },

  BM_REPORT: {
    displayName: 'BM Report',
    project: 'BM',
    repository: 'csi-bm-report-java-service',
    aliases: [
      'csi-bm-report-java-service',
      'prod-bmreportjava',
      'bmreportjava',
    ]
  }

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
 * Rules:
 *  - Returns `{ ok: true, result }` when all inputs map to the SAME project+repo.
 *  - Returns `{ ok: false, error }` when inputs resolve to different projects.
 *  - Returns `{ ok: false, error }` when no match is found.
 */
export function resolveServices(serviceNames: string[]):
  | { ok: true; result: ResolvedService }
  | { ok: false; error: string } {
  if (!serviceNames.length) {
    return { ok: false, error: 'No service names provided.' };
  }

  // Find registry match for each input name
  const resolved = serviceNames.map(name => findMatch(name));

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

/** Internal: find the first registry entry whose aliases match the given name */
function findMatch(name: string): ResolvedService | null {
  const lower = name.toLowerCase();
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
