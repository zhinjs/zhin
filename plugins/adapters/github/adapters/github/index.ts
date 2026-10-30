import { GithubAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/github/index.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / oauth / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type GithubEndpointConfig,
} from '../../src/protocol.js';

export { GithubEndpoint } from '../../src/endpoint.js';
export type { GithubEndpointOptions } from '../../src/endpoint.js';


export default defineAdapter<GithubEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // Issue/PR 评论以 markdown 图片链接消费远程 URL；无交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url'],
    interactive: 'text',
  },
  createAdapter: context => new GithubAdapter(context),
});
