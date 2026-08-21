/**
 * Convention entry: discover `adapters/github.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / oauth / protocol).
 */
import { defineAdapter, type AdapterContext } from 'zhin.js/adapter';
import { messageGatewayToken, sideEventGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  databaseHostToken,
  type PluginDatabaseHost,
} from 'zhin.js';
import { GithubEndpoint } from '../src/endpoint.js';
import { githubRuntimeStateToken } from '../src/github-runtime-state.js';
import {
  resolveGithubConfig,
  type GithubAdapterConfig,
} from '../src/protocol.js';

export { GithubEndpoint } from '../src/endpoint.js';
export type { GithubEndpointOptions } from '../src/endpoint.js';

function optionalDatabase(context: AdapterContext): PluginDatabaseHost | undefined {
  try {
    return context.use(databaseHostToken);
  } catch {
    return undefined;
  }
}

export default defineAdapter<GithubAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // Issue/PR 评论以 markdown 图片链接消费远程 URL；无交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveGithubConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    const sideEvents = context.use(sideEventGatewayToken);
    const database = optionalDatabase(context);
    // 注册到插件运行时状态（github.endpoint list 的"运行中"数据源）
    context.use(githubRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.webhookSecret ? 'webhook' : 'api',
    });
    if (config.webhookSecret) {
      return new GithubEndpoint({
        id: context.id,
        gateway,
        sideEvents,
        http: context.use(httpHostToken),
        database,
        config,
      });
    }
    // API-only: Issue/PR send + agent tools without webhook.
    return new GithubEndpoint({
      id: context.id,
      gateway,
      sideEvents,
      database,
      config,
    });
  },
});
