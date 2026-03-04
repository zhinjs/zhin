import type { Logger } from '@zhin.js/logger';

/**
 * PluginLike — 最小插件接口。
 *
 * kernel 中的 Feature / Cron / Scheduler 仅依赖此接口，
 * 上层框架通过实现此接口来对接 kernel 的功能。
 */
export interface PluginLike {
  readonly name: string;
  readonly logger: Logger;
  readonly root: PluginLike;
  readonly children: PluginLike[];
  readonly started: boolean;

  inject(name: string): unknown;
  provide(target: unknown): this;
  onDispose(callback: () => void | Promise<void>): () => void;
  recordFeatureContribution(featureName: string, itemName: string): void;
}
