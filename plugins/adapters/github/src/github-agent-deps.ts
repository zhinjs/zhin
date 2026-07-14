/**
 * Shared runtime deps for github agent/ authoring tools.
 */
import type { Plugin } from 'zhin.js';
import type { GitHubAdapter } from './adapter.js';
import type { WorkspaceManager } from './workspace-manager.js';

export interface GithubAgentDeps {
  getAdapter: () => GitHubAdapter;
  getWorkspaceManager: () => WorkspaceManager;
  plugin: Plugin;
}

let _deps: GithubAgentDeps | null = null;

export function setGithubAgentDeps(deps: GithubAgentDeps): void {
  _deps = deps;
}

export function getGithubAgentDeps(): GithubAgentDeps {
  if (!_deps) throw new Error('github agent deps not initialized');
  return _deps;
}

export function getAdapter(): GitHubAdapter {
  return getGithubAgentDeps().getAdapter();
}
