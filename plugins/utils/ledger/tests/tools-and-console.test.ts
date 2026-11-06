import { createFakePlugin, FakeClock } from '@zhin.js/testing';
import { pluginConsoleRpcToken, type PluginConsoleRpcCall } from 'zhin.js';
import plugin from '../plugin.js';
import { createLedgerConsoleRpc } from '../src/console.js';
import type { LedgerConfig } from '../src/config.js';
import { ledgerServiceToken } from '../src/runtime.js';
import { ledgerCallerFromTool } from '../src/tool-caller.js';
import ledgerAddTool from '../skills/ledger/tools/ledger_add/index.js';
import ledgerSummaryTool from '../skills/ledger/tools/ledger_summary/index.js';
import ledgerListTool from '../skills/ledger/tools/ledger_list/index.js';
import ledgerDeleteTool from '../skills/ledger/tools/ledger_delete/index.js';
import LedgerPage, { meta as ledgerPageMeta } from '../pages/index/index.js';

const WEDNESDAY_10_00_SHANGHAI = Date.UTC(2026, 9, 21, 2, 0, 0);

describe('ledger AI tools, Console RPC, and declarative page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('executes ledger_add, ledger_summary, ledger_list, and ledger_delete tools', async () => {
    const clock = new FakeClock(WEDNESDAY_10_00_SHANGHAI);
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now());
    const fake = createFakePlugin<Partial<LedgerConfig>>({
      name: 'ledger',
      clock,
      config: { timezone: 'Asia/Shanghai', reportTime: '22:00' },
      hosts: { outbound: true },
    });
    await fake.setup(plugin);

    const toolContext = {
      ...fake.capabilityContext(),
      locale: 'zh-CN' as const,
      signal: new AbortController().signal,
      traceId: 'trace-1',
      turnId: 'turn-1',
      sessionKey: 'sess-1',
      origin: {
        kind: 'im' as const,
        platform: 'sandbox',
        endpoint: 'bot',
        scope: 'private' as const,
        sceneId: 'alice',
      },
      principal: { subjectId: 'alice', roles: [] },
      policy: { permissions: [], unattended: false, network: { enabled: false } },
      $client: undefined,
    };

    expect(ledgerAddTool.requiresApproval).toBe('always');
    expect(ledgerSummaryTool.readOnly).toBe(true);
    expect(ledgerListTool.readOnly).toBe(true);
    expect(ledgerDeleteTool.requiresApproval).toBe('always');

    const added1 = await ledgerAddTool.execute(
      { category: '午饭', amount: 18.5, note: '面条' },
      toolContext as never,
    );
    expect(added1).toBe('✅ 已记账 #1 · 午饭 ¥18.50 · 面条');

    const added2 = await ledgerAddTool.execute(
      { category: '咖啡', amount: 15 },
      toolContext as never,
    );
    expect(added2).toBe('✅ 已记账 #2 · 咖啡 ¥15.00');

    const summary = await ledgerSummaryTool.execute(
      { period: 'today', mode: 'summary' },
      toolContext as never,
    );
    expect(summary).toContain('合计 ¥33.50 · 2 笔');

    const categories = await ledgerSummaryTool.execute(
      { period: 'month', mode: 'categories' },
      toolContext as never,
    );
    expect(categories).toContain('分类统计');
    expect(categories).toContain('午饭');
    expect(categories).toContain('咖啡');

    const listed = await ledgerListTool.execute(
      { period: 'today' },
      toolContext as never,
    );
    expect(listed).toContain('#1');
    expect(listed).toContain('#2');

    const deleted = await ledgerDeleteTool.execute(
      { seq: 1 },
      toolContext as never,
    );
    expect(deleted).toBe('🗑️ 已删除 #1 · 午饭 ¥18.50');

    const nonImResult = await ledgerListTool.execute(
      { period: 'today' },
      { ...toolContext, origin: { kind: 'schedule', jobId: 'job-1' } } as never,
    );
    expect(nonImResult).toContain('具体用户');

    // Group privacy check: amounts are masked in group reply or delivered privately
    const groupContext = {
      ...toolContext,
      origin: {
        kind: 'im' as const,
        platform: 'sandbox',
        endpoint: 'bot',
        scope: 'group' as const,
        sceneId: 'group-100',
      },
    };
    const groupAdded = await ledgerAddTool.execute(
      { category: '晚餐', amount: 42, note: '聚餐' },
      groupContext as never,
    );
    expect(groupAdded).toContain('¥***');
    expect(groupAdded).not.toContain('42.00');

    const groupSummary = await ledgerSummaryTool.execute(
      { period: 'today', mode: 'summary' },
      groupContext as never,
    );
    expect(groupSummary).toContain('私信');
    expect(groupSummary).not.toContain('42.00');

    await fake.dispose();
  });

  it('builds a LedgerCaller from senderId or principal in tool contexts', () => {
    const caller = ledgerCallerFromTool({
      locale: 'en',
      senderId: 'bob',
      origin: {
        kind: 'im',
        platform: 'sandbox',
        endpoint: 'bot-1',
        scope: 'group',
        sceneId: 'group-9',
      },
    });
    expect(caller.senderId).toBe('bob');
    expect(caller.isPrivate).toBe(false);
    expect(caller.privateTarget).toEqual({
      endpoint: { adapter: 'sandbox', id: 'bot-1' },
      kind: 'private',
      id: 'bob',
    });
  });

  it('provides Console RPC status and runDailyReports action', async () => {
    const clock = new FakeClock(Date.UTC(2026, 9, 21, 14, 5, 0)); // 22:05 Asia/Shanghai
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now());
    const fake = createFakePlugin<Partial<LedgerConfig>>({
      name: 'ledger',
      clock,
      config: { timezone: 'Asia/Shanghai', reportTime: '22:00', reportWhenEmpty: true },
      hosts: { outbound: true },
    });
    await fake.setup(plugin);

    const service = fake.resources.use(ledgerServiceToken);
    const caller = ledgerCallerFromTool({
      locale: 'zh-CN',
      senderId: 'alice',
      origin: {
        kind: 'im',
        platform: 'sandbox',
        endpoint: 'bot',
        scope: 'private',
        sceneId: 'alice',
      },
    });
    await service.dailyReport(caller, 'on');
    // Reset lastReportDate by advancing to next day 22:05
    clock.set(Date.UTC(2026, 9, 22, 14, 5, 0));

    const rpc = fake.resources.use(pluginConsoleRpcToken);
    const statusMethod = rpc.methods.get('status');
    expect(statusMethod?.page).toBe('index');
    expect(statusMethod?.requiredPermissions).toEqual(['ledger:read']);

    const call: PluginConsoleRpcCall = {
      signal: new AbortController().signal,
    };
    const snapshot = await statusMethod!.handler({}, call);
    expect(snapshot).toEqual({
      timezone: 'Asia/Shanghai',
      reportTime: '22:00',
      reportWhenEmpty: true,
      subscriberCount: 1,
      subscribers: [
        {
          ownerKey: JSON.stringify(['sandbox', 'bot', 'alice']),
          reportLocale: 'zh-CN',
          lastReportDate: '2026-10-21',
        },
      ],
    });

    const runAction = rpc.methods.get('runDailyReports') ?? rpc.methods.get('run-daily-reports');
    expect(runAction?.page).toBe('index');
    expect(runAction?.requiredPermissions).toEqual(['ledger:write']);

    const runtimeRpc = createLedgerConsoleRpc();
    const runtimeCall = {
      signal: new AbortController().signal,
      runtime: {
        owner: 'root',
        generation: 1,
        operator: true,
        project: () => undefined,
        use: (token: unknown) => (token === ledgerServiceToken ? service : undefined),
      },
    } as unknown as PluginConsoleRpcCall;
    const actionResult = await runtimeRpc.methods.get('runDailyReports')!.handler({}, runtimeCall);
    expect(actionResult).toEqual({ sent: 1 });

    await fake.dispose();
  });

  it('exports declarative page metadata and component', () => {
    expect(ledgerPageMeta).toMatchObject({
      title: '记账本',
      titleI18n: { en: 'Ledger' },
      icon: 'Wallet',
      order: 50,
      requiredPermissions: ['ledger:read'],
    });
    expect(typeof LedgerPage).toBe('function');
  });
});
