/**
 * Convention entry: discover `adapters/github.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / oauth / protocol).
 */
import { defineAdapter, type AdapterContext } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  databaseHostToken,
  type DatabaseHost,
} from '@zhin.js/plugin-runtime';
import { GithubEndpoint } from '../src/endpoint.js';
import {
  resolveGithubConfig,
  type GithubAdapterConfig,
} from '../src/protocol.js';

export { GithubEndpoint } from '../src/endpoint.js';
export type { GithubEndpointOptions } from '../src/endpoint.js';

function optionalDatabase(context: AdapterContext): DatabaseHost | undefined {
  try {
    return context.use(databaseHostToken);
  } catch {
    return undefined;
  }
}

export default defineAdapter<GithubAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveGithubConfig(context.config);
    const database = optionalDatabase(context);
    if (config.webhookSecret) {
      return new GithubEndpoint({
        id: context.id,
        gateway: context.use(messageGatewayToken),
        http: context.use(httpHostToken),
        database,
        config,
      });
    }
    // API-only: Issue/PR send + agent tools without webhook.
    return new GithubEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      database,
      config,
    });
  },
});
