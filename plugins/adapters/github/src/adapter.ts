import { GhClient } from './gh-client.js';
import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { GithubEndpoint } from './endpoint.js';
import { resolveGithubConfig, type GithubEndpointConfig } from './protocol.js';
import type { GithubClientEventMap } from './client.js';
import { httpHostToken } from '@zhin.js/host-http';
import { databaseHostToken } from 'zhin.js';

export class GithubAdapter extends Adapter<GithubEndpoint, GithubEndpointConfig, GithubClientEventMap> {
  readonly #context: AdapterContext<GithubEndpointConfig>;
  constructor(context: AdapterContext<GithubEndpointConfig>) { super(); this.#context = context; }
  override get configurationIdentityFields(): readonly string[] { return ['id', 'app_id', 'host']; }
  override get configurationUpdateFields(): readonly string[] { return ['private_key', 'webhook_secret', 'webhook_path', 'auto_reply_repos', 'bot_login', 'workspace_root']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['private_key']; }
  protected override async identifyConfiguration(input: GithubEndpointConfig, signal: AbortSignal, _changed: readonly string[]): Promise<string | undefined> {
    const config = resolveGithubConfig(input), client = new GhClient({ host: config.host, appAuth: { appId: config.appId, privateKey: config.privateKey }, signal });
    const authenticated = await client.verifyAuth(); signal.throwIfAborted();
    if (!authenticated.ok) throw new Error('GitHub application identity verification failed');
    const identity = await client.getBotIdentity(); signal.throwIfAborted();
    if (!identity?.userId) throw new Error('GitHub identity verification returned no bot userId');
    return JSON.stringify(['github', config.host ?? 'github.com', identity.userId]);
  }
  protected override validateConfiguration(config: GithubEndpointConfig): void { resolveGithubConfig(config); }
  protected createEndpoint(input: GithubEndpointConfig, execution: EndpointCreationContext): GithubEndpoint {
    const config = resolveGithubConfig(input);
    return new GithubEndpoint({ id: execution.canonicalId, config, ...(config.webhookSecret ? { http: this.#context.use(httpHostToken) } : {}), ...(this.#context.has?.(databaseHostToken) ? { database: this.#context.use(databaseHostToken) } : {}) });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'github': GithubAdapter; }
}
