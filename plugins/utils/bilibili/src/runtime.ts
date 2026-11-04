import type { DeliveryTarget, TargetMigrationScopes } from 'zhin.js/plugin-runtime';
import type { Locale } from 'zhin.js/i18n';
import { createToken } from 'zhin.js';
import type { BiliClient } from './api.js';
import type { ChannelInfo } from './channel.js';
import type { ResolvedBilibiliConfig } from './config.js';
import type { BiliDb } from './store.js';
import type { BilibiliWatcher } from './poll.js';

export type BiliOutboundPush = (input: {
  /** Explicit canonical target on new records; absent only at the pending historical-data boundary. */
  readonly target?: DeliveryTarget;
  readonly adapterName: string;
  readonly endpointKey: string;
  readonly channelType: ChannelInfo['channelType'];
  readonly channelId: string;
  readonly content: string;
  readonly locale?: Locale;
}) => Promise<void>;

export interface BilibiliRuntime {
  readonly migrationScopes?: TargetMigrationScopes;
  readonly db: BiliDb;
  readonly config: Readonly<ResolvedBilibiliConfig>;
  readonly client: BiliClient;
  readonly outbound: BiliOutboundPush | null;
  readonly watcher: BilibiliWatcher;
  /** False when no database is configured (subscriptions live in memory). */
  readonly persistent: boolean;
}

export const bilibiliRuntimeToken = createToken<BilibiliRuntime>(
  'zhin.bilibili.runtime',
  'Owner-scoped Bilibili subscription runtime',
);
