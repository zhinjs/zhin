/** Domain notifier only; account ownership and review/login directory are projected from the Adapter. */
import { createToken } from 'zhin.js';
import type { ResolvedBilibiliNotifyTarget } from './protocol.js';

/** 返回 false 表示当前没有可用的出站通道（只记日志）。 */
export type BilibiliNotifier = (target: ResolvedBilibiliNotifyTarget, text: string) => Promise<boolean>;

export const bilibiliNotifierToken = createToken<BilibiliNotifier>(
  'zhin.bilibili-comment.notifier',
  'Pushes Bilibili draft / login notices to a configured chat conversation via OutboundHost',
);
