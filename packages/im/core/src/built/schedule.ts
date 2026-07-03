/**
 * ScheduleFeature — 管理插件注册的内存定时任务
 */
import {
  Feature,
  FeatureJSON,
  ScheduleEngine,
  getScheduleEngine,
  setScheduleEngine,
  type ScheduleKind,
} from '@zhin.js/kernel';
import type { HolidayInput, ScatterInput } from '@zhin.js/kernel';
import { Plugin, getPlugin } from '../plugin.js';

export interface ScheduleDescriptor {
  kind: ScheduleKind | 'every' | 'at';
  /** 6 段 cron（solar/lunar/workday/freeDay/holiday） */
  cron?: string;
  everyMs?: number;
  atMs?: number;
  scatterInput?: ScatterInput;
  holidayInput?: HolidayInput;
  tz?: string;
}

export interface ScheduleHandle {
  id: string;
  descriptor: ScheduleDescriptor;
  dispose: () => void;
}

export interface ScheduleContextExtensions {
  addSchedule(
    descriptor: ScheduleDescriptor,
    callback: () => void | Promise<void>,
    id?: string,
  ): () => void;
}

declare module '../plugin.js' {
  namespace Plugin {
    interface Extensions extends ScheduleContextExtensions {}
    interface Contexts {
      schedule: ScheduleFeature;
    }
  }
}

function ensureEngine(): ScheduleEngine {
  let engine = getScheduleEngine();
  if (!engine) {
    engine = new ScheduleEngine();
    setScheduleEngine(engine);
  }
  return engine;
}

export class ScheduleFeature extends Feature<ScheduleHandle> {
  readonly name = 'schedule' as const;
  readonly icon = 'Clock';
  readonly desc = '日历调度';

  readonly byName = new Map<string, ScheduleHandle>();

  add(handle: ScheduleHandle, pluginName: string): () => void {
    this.byName.set(handle.id, handle);
    return super.add(handle, pluginName);
  }

  remove(handle: ScheduleHandle): boolean {
    handle.dispose();
    this.byName.delete(handle.id);
    return super.remove(handle);
  }

  get(id: string): ScheduleHandle | undefined {
    return this.byName.get(id);
  }

  stopAll(): void {
    for (const handle of this.items) {
      handle.dispose();
    }
  }

  getStatus(): Array<{
    id: string;
    kind: string;
    expression?: string;
    running: boolean;
    nextExecution: Date | null;
    plugin: string;
  }> {
    const engine = getScheduleEngine();
    const engineStatus = engine?.getStatus() ?? [];
    const byId = new Map(engineStatus.map((s) => [s.id, s]));

    return this.items.map((handle) => {
      let pluginName = 'unknown';
      for (const [name, items] of this.pluginItems) {
        if (items.includes(handle)) {
          pluginName = name;
          break;
        }
      }
      const st = byId.get(handle.id);
      return {
        id: handle.id,
        kind: handle.descriptor.kind,
        expression: handle.descriptor.cron,
        running: st?.running ?? true,
        nextExecution: st?.nextExecution ?? null,
        plugin: pluginName,
      };
    });
  }

  dispose(): void {
    this.stopAll();
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map((h) => ({
        id: h.id,
        kind: h.descriptor.kind,
        cron: h.descriptor.cron,
      })),
    };
  }

  get extensions() {
    const feature = this;
    return {
      addSchedule(
        descriptor: ScheduleDescriptor,
        callback: () => void | Promise<void>,
        id?: string,
      ) {
        const plugin = getPlugin();
        const jobId = id ?? `sched_${Math.random().toString(36).slice(2, 10)}`;
        const engine = ensureEngine();
        const disposeEngine = engine.register(jobId, descriptor.kind, async () => {
          await callback();
        }, {
          cron: descriptor.cron,
          everyMs: descriptor.everyMs,
          atMs: descriptor.atMs,
          scatterInput: descriptor.scatterInput,
          holidayInput: descriptor.holidayInput,
          tz: descriptor.tz,
        });
        const handle: ScheduleHandle = {
          id: jobId,
          descriptor,
          dispose: () => {
            disposeEngine();
            feature.byName.delete(jobId);
            feature.remove(handle);
          },
        };
        const dispose = feature.add(handle, plugin.name);
        plugin.recordFeatureContribution(feature.name, jobId);
        plugin.onDispose(() => {
          handle.dispose();
          dispose();
        });
        return () => {
          handle.dispose();
          dispose();
        };
      },
    };
  }
}
