/**
 * Shared runtime deps for github agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { Plugin } from 'zhin.js';
import type { GitHubAdapter } from './adapter.js';

export interface GithubAgentDeps {
  getAdapter: () => GitHubAdapter;
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
