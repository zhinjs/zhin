import type { Locale } from 'zhin.js/i18n';
import { createToken } from 'zhin.js';
import type { RssConfig } from './feed.js';
import type { RssMemoryDb } from './memory-store.js';
import type { ChannelInfo } from './channel.js';

export type RssOutboundPush = (input: {
  readonly adapterName: string;
  readonly endpointKey: string;
  readonly channelType: ChannelInfo['channelType'];
  readonly channelId: string;
  readonly content: string;
}) => Promise<void>;

export interface RssRuntime {
  readonly locale?: Locale;
  readonly db: RssMemoryDb;
  readonly config: Readonly<RssConfig>;
  readonly outbound: RssOutboundPush | null;
}

export const rssRuntimeToken = createToken<RssRuntime>(
  'zhin.rss.runtime',
  'Owner-scoped RSS runtime',
);
