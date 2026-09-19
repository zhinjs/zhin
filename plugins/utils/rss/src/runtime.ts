import { createToken } from 'zhin.js';
import type { RssConfig } from './feed.js';
import type { RssMemoryDb } from './memory-store.js';

export type RssOutboundPush = (input: {
  readonly adapterName: string;
  readonly endpointKey: string;
  readonly channelType: string;
  readonly channelId: string;
  readonly content: string;
}) => Promise<void>;

export interface RssRuntime {
  readonly db: RssMemoryDb;
  readonly config: Readonly<RssConfig>;
  readonly outbound: RssOutboundPush | null;
}

export const rssRuntimeToken = createToken<RssRuntime>(
  'zhin.rss.runtime',
  'Owner-scoped RSS runtime',
);
