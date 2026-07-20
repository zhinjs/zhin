import { createToken } from '@zhin.js/plugin-runtime';
import type { LotteryDb } from './db.js';

export interface LotteryRuntime {
  readonly db: LotteryDb;
}

export const lotteryRuntimeToken = createToken<LotteryRuntime>(
  'zhin.lottery.runtime',
  'Owner-scoped Lottery database',
);

export function resolveLotteryRuntime(context: {
  owner?: { id?: unknown };
  use<T>(token: typeof lotteryRuntimeToken): T;
}): LotteryRuntime | undefined {
  try {
    return context.use(lotteryRuntimeToken) as LotteryRuntime;
  } catch (error) {
    if (context.owner?.id) throw error;
    return undefined;
  }
}
