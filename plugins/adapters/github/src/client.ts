import path from 'node:path';
import type { PluginDatabaseHost } from 'zhin.js';
import { defineEndpointClient } from 'zhin.js/adapter';
import { GhClient } from './gh-client.js';
import { lookupGithubOauthAccessToken } from './oauth-users.js';
import type { ResolvedGithubConfig } from './protocol.js';
import { WorkspaceManager } from './workspace-manager.js';

/** GitHub SDK surface exposed to plugin handlers and Agent tools. */
export class GithubClient {
  #workspaceManager?: WorkspaceManager;

  constructor(
    readonly name: string,
    readonly api: GhClient,
    readonly config: ResolvedGithubConfig,
    readonly database?: PluginDatabaseHost,
  ) {}

  async getUserOrDefaultApi(platform?: string, platformUid?: string): Promise<GhClient> {
    if (platform && platformUid) {
      const token = await lookupGithubOauthAccessToken(this.database, platform, platformUid);
      if (token) return this.api.withToken(token);
    }
    return this.api;
  }

  get clientId(): string | null {
    return this.api.clientId || null;
  }

  get host(): string | undefined {
    return this.config.host;
  }

  get appSlug(): string | null {
    return this.api.appSlug || null;
  }

  get installations() {
    return this.api.installations || [];
  }

  get workspaceManager(): WorkspaceManager {
    if (!this.#workspaceManager) {
      const root = this.config.workspaceRoot
        ?? path.join(process.cwd(), 'data', 'github-workspaces');
      this.#workspaceManager = new WorkspaceManager(this.api, root);
    }
    return this.#workspaceManager;
  }
}

export type GithubClientEventMap = Record<string, unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly github: {
      readonly client: GithubClient;
      readonly events: GithubClientEventMap;
    };
  }
}

export const githubClient = defineEndpointClient<GithubClient, GithubClientEventMap>('github');
