import { createToken } from '@zhin.js/plugin-runtime';
import type { LotteryConfig } from './config.js';
import type { LotteryDb } from './db.js';
import type { GameId } from './types.js';

export interface LotteryRuntime {
  readonly db: LotteryDb;
  readonly config: Readonly<LotteryConfig>;
  readonly enabledGames: readonly GameId[];
  readonly outbound: ((text: string) => Promise<void>) | null;
}

export const lotteryRuntimeToken = createToken<LotteryRuntime>(
  'zhin.lottery.runtime',
  'Owner-scoped Lottery runtime',
);
