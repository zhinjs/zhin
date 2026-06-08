/**
 * RemoteTaskPoller — 轮询远程 MCP 任务状态（Agent Mesh v1）。
 */
import { Logger } from '@zhin.js/logger';
import { getOrchestrationService } from './orchestration-service.js';
import { getAgentDispatcher } from './agent-dispatcher.js';
import { pollRemoteTaskStatus } from './remote-task-executor.js';

const logger = new Logger(null, 'RemoteTaskPoller');

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
      const dispatcher = getAgentDispatcher();
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

let globalPoller: RemoteTaskPoller | null = null;

export function getRemoteTaskPoller(): RemoteTaskPoller {
  if (!globalPoller) {
    globalPoller = new RemoteTaskPoller();
  }
  return globalPoller;
}

export function startRemoteTaskPoller(config?: RemoteTaskPollerConfig): RemoteTaskPoller {
  globalPoller = new RemoteTaskPoller(config);
  globalPoller.start();
  return globalPoller;
}
