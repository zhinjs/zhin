/** Domain notifier only; account ownership and review directory are projected from the Adapter. */
import { definePluginStore } from 'zhin.js';
import type { ResolvedJuejinNotifyTarget } from './protocol.js';

/** 返回 false 表示当前没有可用的出站通道（只记日志）。 */
export type JuejinNotifier = (target: ResolvedJuejinNotifyTarget, text: string) => Promise<boolean>;

export const juejinNotifierStore = definePluginStore<JuejinNotifier>(
  'zhin.juejin-comment.notifier',
  'Pushes Juejin draft / login notices to a configured chat conversation via OutboundHost',
);
export const juejinNotifierToken = juejinNotifierStore;
