import { describe, expect, it } from 'vitest';
import {
  addKeyword,
  createGroupSuiteConsoleRpc,
  createGroupSuiteRuntime,
  doCheckin,
  GROUP_SUITE_READ_PERMISSION,
  groupSuiteRuntimeToken,
  keywordStore,
  resolveGroupSuiteConfig,
  teachAdd,
  type GroupSuiteConsoleStatus,
} from '../src/index.js';
import { createInMemoryGroupSuiteDb, type GroupSuiteModel } from '../src/memory-store.js';
import Page, { meta } from '../pages/index/index.ts';

const groupInput = {
  sender: { id: 'u1', name: 'Alice' },
  conversation: { kind: 'group' as const, id: 'g1', endpoint: { id: 'bot', adapter: 'test' } },
  content: '',
  metadata: { type: 'group', senderName: 'Alice' },
};

describe('@zhin.js/plugin-group-suite Console RPC & Declarative Page', () => {
  it('exports declarative page metadata and component', () => {
    expect(meta.title).toBe('群管套件');
    expect(meta.titleI18n).toEqual({ en: 'Group Suite' });
    expect(meta.icon).toBe('Users');
    expect(meta.order).toBe(54);
    expect(meta.requiredPermissions).toEqual([GROUP_SUITE_READ_PERMISSION]);
    expect(typeof Page).toBe('function');
  });

  it('returns status with topCheckins and keywords from runtime', async () => {
    const db = createInMemoryGroupSuiteDb();
    const runtime = createGroupSuiteRuntime(db);
    const config = resolveGroupSuiteConfig({});

    await doCheckin(groupInput, config, runtime);
    await teachAdd(groupInput, config, '早安 早上好！', false, runtime);
    addKeyword('你好', '欢迎光临', keywordStore(groupInput, runtime));

    const rpc = createGroupSuiteConsoleRpc();
    const statusMethod = rpc.methods.get('status');
    expect(statusMethod).toBeDefined();
    expect(statusMethod?.page).toBe('index');
    expect(statusMethod?.requiredPermissions).toEqual([GROUP_SUITE_READ_PERMISSION]);

    const status = (await statusMethod!.handler(
      {},
      {
        signal: new AbortController().signal,
        runtime: {
          owner: 'root/group-suite' as never,
          generation: 1,
          operator: true,
          project: () => undefined,
          use: <T>(token: unknown): T => (token === groupSuiteRuntimeToken ? (runtime as T) : (undefined as T)),
        } as never,
      },
    )) as unknown as GroupSuiteConsoleStatus;

    expect(status.checkinCount).toBe(1);
    expect(status.keywordCount).toBe(2);
    expect(status.topCheckins).toHaveLength(1);
    expect(status.topCheckins[0]?.userId).toBe('u1');
    expect(status.topCheckins[0]?.totalDays).toBe(1);
    expect(status.topCheckins[0]?.points).toBeGreaterThanOrEqual(10);
    expect(status.keywords).toHaveLength(2);
    expect(status.keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(['早安', '你好']));
  });

  it('supports legacy table aliases (group_checkin / group_keywords) and handles query errors gracefully', async () => {
    const checkinRows = [
      { user_id: 'u2', group_id: 'g2', total_days: 5, streak_days: 3, points: 80, last_date: '2026-11-06' },
      { user_id: 'u1', group_id: 'g2', total_days: 10, streak_days: 10, points: 200, last_date: '2026-11-06' },
    ];
    const keywordRows = [
      { group_id: 'g2', keyword: 'help', reply: 'Here is help', creator_id: 'admin' },
    ];

    const customModels = new Map<string, GroupSuiteModel>([
      [
        'group_checkin',
        {
          select: () => ({
            where: async () => checkinRows,
            then: (onfulfilled, onrejected) => Promise.resolve(checkinRows).then(onfulfilled, onrejected),
          }),
          insert: async () => ({}),
          delete: () => ({ where: async () => undefined }),
          update: () => ({ where: async () => undefined }),
        },
      ],
      [
        'group_keywords',
        {
          select: () => ({
            where: async () => keywordRows,
            then: (onfulfilled, onrejected) => Promise.resolve(keywordRows).then(onfulfilled, onrejected),
          }),
          insert: async () => ({}),
          delete: () => ({ where: async () => undefined }),
          update: () => ({ where: async () => undefined }),
        },
      ],
      [
        'group_daily_stats',
        {
          select: () => ({
            where: async () => {
              throw new Error('stats query failed');
            },
            then: (_onfulfilled, onrejected) => Promise.reject(new Error('stats query failed')).then(undefined, onrejected),
          }),
          insert: async () => ({}),
          delete: () => ({ where: async () => undefined }),
          update: () => ({ where: async () => undefined }),
        },
      ],
    ]);

    const runtime = createGroupSuiteRuntime({
      models: {
        get: (name: string) => customModels.get(name),
      },
    });
    const rpc = createGroupSuiteConsoleRpc(runtime);
    const status = (await rpc.methods.get('status')!.handler(
      {},
      { signal: new AbortController().signal },
    )) as unknown as GroupSuiteConsoleStatus;

    expect(status.checkinCount).toBe(2);
    expect(status.topCheckins[0]?.userId).toBe('u1');
    expect(status.topCheckins[0]?.points).toBe(200);
    expect(status.keywordCount).toBe(1);
    expect(status.keywords[0]).toEqual({
      groupId: 'g2',
      keyword: 'help',
      reply: 'Here is help',
      creatorId: 'admin',
    });
  });
});
