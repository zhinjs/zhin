import { describe, expect, it, vi } from 'vitest';
import type { PluginConsoleRpcCall, PluginStateStore } from 'zhin.js';
import { createReminderConsoleRpc } from '../src/console.js';
import { reminderServiceToken } from '../src/runtime.js';
import { ReminderService } from '../src/service.js';
import ReminderPage, { meta as reminderPageMeta } from '../pages/index/index.js';

function createMemoryStateStore(): PluginStateStore {
  const store = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return store.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return store.delete(key);
    },
    async update<T>(key: string, updater: (current: T | undefined) => T | undefined): Promise<T | undefined> {
      const next = updater(store.get(key) as T | undefined);
      if (next === undefined) {
        store.delete(key);
      } else {
        store.set(key, next);
      }
      return next;
    },
  };
}

describe('reminder Console RPC and declarative page', () => {
  it('returns active reminders and quota configuration from Console RPC status', async () => {
    const start = Date.UTC(2026, 9, 21, 10, 0, 0);
    vi.spyOn(Date, 'now').mockReturnValue(start);

    const state = createMemoryStateStore();
    const outbound = {
      send: vi.fn().mockResolvedValue(null),
      sendTarget: vi.fn().mockResolvedValue('msg-1'),
    };
    const service = new ReminderService(
      state,
      outbound,
      {
        timezone: 'Asia/Shanghai',
        maxTasks: 20,
        adminMaxTasks: 20,
        maxTasksPerSender: 8,
        batchSize: 5,
        missedGraceSeconds: 15,
      },
      'zh-CN',
    );

    const actor = {
      senderId: 'alice',
      target: {
        endpoint: { adapter: 'sandbox', id: 'bot' },
        kind: 'private' as const,
        id: 'alice',
      },
      locale: 'zh-CN' as const,
    };

    const task1 = await service.add(actor, '喝水', start + 60_000, null);
    const task2 = await service.add(actor, '站起来活动', start + 120_000, 60_000);
    await service.cancel(actor, task1.id);

    const rpc = createReminderConsoleRpc(service);
    const statusMethod = rpc.methods.get('status');
    expect(statusMethod?.page).toBe('index');
    expect(statusMethod?.requiredPermissions).toEqual(['reminder:read']);

    const call: PluginConsoleRpcCall = {
      signal: new AbortController().signal,
    };
    const snapshot = await statusMethod!.handler({}, call);
    expect(snapshot).toEqual({
      timezone: 'Asia/Shanghai',
      maxPerUser: 8,
      activeCount: 1,
      reminders: [
        {
          id: task2.id,
          text: '站起来活动',
          nextFireAt: new Date(start + 120_000).toISOString(),
          intervalMs: 60_000,
          status: 'pending',
        },
      ],
    });

    const runtimeRpc = createReminderConsoleRpc();
    const runtimeCall = {
      signal: new AbortController().signal,
      runtime: {
        owner: 'root',
        generation: 1,
        operator: true,
        project: () => undefined,
        use: (token: unknown) => (token === reminderServiceToken ? service : undefined),
      },
    } as unknown as PluginConsoleRpcCall;
    const runtimeSnapshot = await runtimeRpc.methods.get('status')!.handler({}, runtimeCall);
    expect(runtimeSnapshot).toEqual(snapshot);

    service.stop();
    vi.restoreAllMocks();
  });

  it('exports declarative page metadata and component', () => {
    expect(reminderPageMeta).toMatchObject({
      title: '持久提醒',
      titleI18n: { en: 'Reminders' },
      icon: 'Bell',
      order: 51,
      requiredPermissions: ['reminder:read'],
    });
    expect(typeof ReminderPage).toBe('function');
  });
});
