/**
 * Agent tool deps for github.
 * Endpoints register themselves on start; tools look up by config name / endpoint id.
 */

import type { GhClient } from './gh-client.js';
import type { ResolvedGithubConfig } from './protocol.js';
import type { WorkspaceManager } from './workspace-manager.js';

export interface GithubAgentEndpoint {
  readonly name: string;
  readonly gh: GhClient;
  readonly config: ResolvedGithubConfig;
  getAPI(): GhClient;
  getUserOrDefaultAPI(platform?: string, platformUid?: string): Promise<GhClient | null>;
  getClientId(): string | null;
  getHost(): string | undefined;
  getAppSlug(): string | null;
  getInstallations(): Array<{ id: number; account: { login: string; type: string }; target_type: string }>;
  getWorkspaceManager(): WorkspaceManager;
  /** DatabaseHost wired at endpoint creation (optional). */
  getDatabase?(): unknown;
}

export interface GithubAgentDeps {
  getEndpoint: (endpointId?: string) => GithubAgentEndpoint;
  /** Alias kept for existing agent handlers that call getAdapter(). */
  getAdapter: () => GithubAgentEndpoint;
  getWorkspaceManager: () => WorkspaceManager;
  getDatabase?: () => { models?: Map<string, unknown> } | null | undefined;
  logger?: {
    debug: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

const endpoints = new Map<string, GithubAgentEndpoint>();
let override: GithubAgentDeps | null = null;

export function registerGithubAgentEndpoint(
  endpointId: string,
  endpoint: GithubAgentEndpoint,
): () => void {
  endpoints.set(endpointId, endpoint);
  return () => {
    if (endpoints.get(endpointId) === endpoint) {
      endpoints.delete(endpointId);
    }
  };
}

/** Optional override used by tests / transitional callers. Pass `null` to clear. */
export function setGithubAgentDeps(deps: GithubAgentDeps | null): void {
  override = deps;
}

function lookup(endpointId?: string): GithubAgentEndpoint {
  if (endpointId) {
    const registered = endpoints.get(endpointId);
    if (!registered) throw new Error(`Endpoint ${endpointId} 不存在`);
    return registered;
  }
  const first = endpoints.values().next().value;
  if (!first) throw new Error('github agent deps not initialized');
  return first;
}

export function getGithubAgentDeps(): GithubAgentDeps {
  if (override) return override;
  return {
    getEndpoint: lookup,
    getAdapter: () => lookup(),
    getWorkspaceManager: () => lookup().getWorkspaceManager(),
    getDatabase: () => lookup().getDatabase?.() as
      { models?: Map<string, unknown> } | null | undefined,
  };
}

export function getAdapter(): GithubAgentEndpoint {
  return getGithubAgentDeps().getAdapter();
}
