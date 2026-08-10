/**
 * RemoteTaskPoller — 轮询远程 A2A 任务状态（Get Task fallback）。
 *
 * Generation-scoped: provide() 注册后随 lifecycle 自动 stop + 反注册。
 */
import { getLogger } from '@zhin.js/logger';
import { createGenerationStore, type GenerationStoreContext } from '@zhin.js/plugin-runtime';
import { getOrchestrationService } from './orchestration-service.js';
import { pollRemoteTaskStatus } from './remote-task-executor.js';

const logger = getLogger('RemoteTaskPoller');

export interface RemoteTaskPollerConfig {
  intervalMs?: number;
  enabled?: boolean;
}

export class RemoteTaskPoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private readonly config: RemoteTaskPollerConfig = {}) {}

  start(): void {
    if (this.config.enabled === false) return;
    if (this.timer) return;
    const intervalMs = this.config.intervalMs ?? 15_000;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
    logger.debug(`RemoteTaskPoller started (interval=${intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const orch = getOrchestrationService();
      if (!orch) return;
      const tasks = await orch.repositoryHandle.listActiveRemoteTasks();
      const dispatcher = orch.dispatcherHandle;
      for (const record of tasks) {
        dispatcher.syncTaskFromRecord(record);
        if (record.remote_task_id) {
          try {
            await pollRemoteTaskStatus(record.id);
          } catch (err) {
            logger.debug(`poll failed for ${record.id}:`, err);
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }
}

const pollerStore = createGenerationStore<RemoteTaskPoller>('zhin.agent.remote-task-poller');

export function getRemoteTaskPoller(): RemoteTaskPoller | null {
  return pollerStore.tryUse() ?? null;
}

export function provideRemoteTaskPoller(
  context: GenerationStoreContext,
  config?: RemoteTaskPollerConfig,
): RemoteTaskPoller {
  const prev = pollerStore.tryUse();
  if (prev) prev.stop();
  const poller = new RemoteTaskPoller(config);
  pollerStore.provide(context, poller);
  context.lifecycle.add(() => poller.stop());
  poller.start();
  return poller;
}

export function stopRemoteTaskPoller(): void {
  const poller = pollerStore.tryUse();
  if (poller) poller.stop();
}
