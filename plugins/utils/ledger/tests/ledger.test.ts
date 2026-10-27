import { createFakePlugin, FakeClock, type FakePlugin } from '@zhin.js/testing';
import { createCapabilitySlot, outboundHostToken, rootPluginId, type RuntimeSnapshot } from 'zhin.js';
import { CommandIndex, commandFeatureId, parseCommandDefinition, type CommandDefinition, type CommandMessage } from 'zhin.js/command';
import plugin from '../plugin.js';
import addCommand from '../commands/ledger-add/index.js';
import todayCommand from '../commands/ledger-today/index.js';
import weekCommand from '../commands/ledger-week/index.js';
import monthCommand from '../commands/ledger-month/index.js';
import deleteCommand from '../commands/ledger-delete/index.js';
import listCommand from '../commands/ledger-list/index.js';
import statsCommand from '../commands/ledger-stats/index.js';
import reportCommand from '../commands/ledger-report/index.js';
import dailyReportSchedule from '../schedules/daily-report/index.js';
import { parseEntryInput } from '../src/entry-input.js';
import { formatCents, parseAmountToCents } from '../src/money.js';
import { isInPeriod, localDateKey, weekStartKey } from '../src/period.js';
import { resolveLedgerConfig, type LedgerConfig } from '../src/config.js';
import { ledgerServiceToken } from '../src/runtime.js';
import { LedgerService } from '../src/service.js';
import { ledgerCaller } from '../src/identity.js';
import { defineLedgerTables, USER_TABLE } from '../src/store.js';

const COMMANDS: Readonly<Record<string, CommandDefinition>> = {
  'ledger-add': addCommand,
  'ledger-today': todayCommand,
  'ledger-week': weekCommand,
  'ledger-month': monthCommand,
  'ledger-delete': deleteCommand,
  'ledger-list': listCommand,
  'ledger-stats': statsCommand,
  'ledger-report': reportCommand,
};

const ENDPOINT = { adapter: 'sandbox', id: 'bot' } as const;

/** Wednesday 2026-10-21 10:00 in Asia/Shanghai. */
const WEDNESDAY_10_00_SHANGHAI = Date.UTC(2026, 9, 21, 2, 0, 0);

function shanghai(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, second);
}

function privateMessage(userId: string, endpoint: { adapter: string; id: string } = ENDPOINT): CommandMessage {
  return { conversation: { endpoint, kind: 'private', id: userId }, sender: { id: userId }, content: '' };
}

function groupMessage(userId: string): CommandMessage {
  return { conversation: { endpoint: ENDPOINT, kind: 'group', id: 'group-1' }, sender: { id: userId }, content: '' };
}

interface Fixture {
  readonly fake: FakePlugin<Partial<LedgerConfig>>;
  readonly clock: FakeClock;
  run(text: string, message: CommandMessage): Promise<string>;
  privateMessagesTo(userId: string): string[];
}

async function createFixture(options: { config?: Partial<LedgerConfig>; outbound?: boolean } = {}): Promise<Fixture> {
  const clock = new FakeClock(WEDNESDAY_10_00_SHANGHAI);
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now());
  const fake = createFakePlugin<Partial<LedgerConfig>>({
    name: 'ledger',
    clock,
    config: options.config ?? { timezone: 'Asia/Shanghai', reportTime: '22:00' },
    hosts: { outbound: options.outbound ?? true },
  });
  await fake.setup(plugin);
  const owner = rootPluginId();
  const slots = Object.entries(COMMANDS).map(([localName, definition]) => createCapabilitySlot({
    owner,
    feature: commandFeatureId,
    localName,
    source: `/commands/${localName}/index.ts`,
    definition,
  }));
  const service = fake.resources.use(ledgerServiceToken);
  const snapshot = {
    generation: 1,
    root: owner,
    tree: new Map([[owner, { id: owner, instanceKey: 'ledger', packageName: '@zhin.js/plugin-ledger', packageRoot: '/ledger', children: [] }]]),
    config: new Map([[owner, fake.config]]),
    resources: new Map([[owner, new Map<string, unknown>([[ledgerServiceToken.id, service]])]]),
    capabilities: new Map(slots.map((slot) => [slot.id, slot])),
    projections: new Map(),
  } satisfies RuntimeSnapshot;
  const index = new CommandIndex(slots, snapshot);
  fake.schedule.register({
    id: 'daily-report',
    cron: dailyReportSchedule.cron,
    execute: () => dailyReportSchedule.execute(fake.capabilityContext()),
  });
  return {
    fake,
    clock,
    async run(text, message) {
      const result = await index.dispatch(text, message);
      expect(result.status).toBe('executed');
      return String(result.value);
    },
    privateMessagesTo(userId) {
      return fake.sent
        .filter((call) => call.kind === 'sendTarget')
        .map((call) => call.input as { target: { kind: string; id: string }; content: string })
        .filter((input) => input.target.kind === 'private' && input.target.id === userId)
        .map((input) => input.content);
    },
  };
}

const fixtures: Fixture[] = [];

async function fixture(options?: Parameters<typeof createFixture>[0]): Promise<Fixture> {
  const created = await createFixture(options);
  fixtures.push(created);
  return created;
}

afterEach(async () => {
  for (const created of fixtures.splice(0)) await created.fake.dispose();
  vi.restoreAllMocks();
});

describe('plugin definition', () => {
  it('declares a database requirement and valid commands', async () => {
    expect(plugin.name).toBe('ledger');
    for (const definition of Object.values(COMMANDS)) expect(parseCommandDefinition(definition)).toBe(definition);
    const created = await fixture();
    expect(created.fake.missingRequirements(plugin)).toEqual([]);
    expect(created.fake.databaseHost.tables().some((name) => name.endsWith('ledger_entries'))).toBe(true);
  });

  it('rejects an invalid timezone or report time at setup', () => {
    expect(() => resolveLedgerConfig({ timezone: 'Mars/Base' })).toThrow('IANA');
    expect(() => resolveLedgerConfig({ reportTime: '24:00' })).toThrow('HH:MM');
    expect(resolveLedgerConfig(undefined)).toEqual({ timezone: 'Asia/Shanghai', reportTime: '22:00', reportWhenEmpty: false });
  });
});

describe('amount parsing (integer cents)', () => {
  it.each([
    ['18', 1800],
    ['18.5', 1850],
    ['18.05', 1805],
    ['0.1', 10],
    ['0.01', 1],
    ['¥18.50', 1850],
    ['18.5元', 1850],
    ['１２．５', 1250],
    ['1000000', 100_000_000],
  ])('parses %s as %i cents', (text, cents) => {
    expect(parseAmountToCents(text)).toEqual({ ok: true, cents });
  });

  it.each(['-5', '-0.5', '0', '0.00', '1.234', '1e3', 'abc', '18.', '.5', 'NaN', 'Infinity', '1,000', '1000000.01', '10000000'])('rejects %s', (text) => {
    expect(parseAmountToCents(text).ok).toBe(false);
  });

  it('explains why a negative amount is rejected', () => {
    expect(parseAmountToCents('-5')).toEqual({ ok: false, reason: '金额不能为负数' });
  });

  it('formats cents without floating point', () => {
    expect(formatCents(30)).toBe('¥0.30');
    expect(formatCents(100_000_000)).toBe('¥1000000.00');
  });
});

describe('entry parsing', () => {
  it('reads category, amount and a note with spaces', () => {
    expect(parseEntryInput('午饭 18.5 和 同事')).toEqual({ ok: true, entry: { category: '午饭', amountCents: 1850, note: '和 同事' } });
    expect(parseEntryInput('  打车   23  ')).toEqual({ ok: true, entry: { category: '打车', amountCents: 2300, note: '' } });
  });

  it('rejects missing amounts, swapped order, numeric categories and long text', () => {
    expect(parseEntryInput('午饭')).toMatchObject({ ok: false, reason: expect.stringContaining('格式') });
    expect(parseEntryInput('18 午饭')).toMatchObject({ ok: false, reason: expect.stringContaining('类别要写在金额前面') });
    expect(parseEntryInput('12 18')).toMatchObject({ ok: false, reason: expect.stringContaining('类别不能是数字') });
    expect(parseEntryInput('午饭 -3')).toMatchObject({ ok: false, reason: expect.stringContaining('负数') });
    expect(parseEntryInput(`${'类'.repeat(21)} 3`)).toMatchObject({ ok: false, reason: expect.stringContaining('20') });
    expect(parseEntryInput(`午饭 3 ${'备'.repeat(101)}`)).toMatchObject({ ok: false, reason: expect.stringContaining('100') });
  });

  it('records through the real command parser and keeps decimal sums exact', async () => {
    const { run } = await fixture();
    expect(await run('记 水果 0.1', privateMessage('alice'))).toBe('✅ 已记账 #1 · 水果 ¥0.10');
    expect(await run('记 水果 0.2 苹果', privateMessage('alice'))).toBe('✅ 已记账 #2 · 水果 ¥0.20 · 苹果');
    expect(await run('今日消费', privateMessage('alice'))).toContain('合计 ¥0.30 · 2 笔');
    expect(await run('记 水果 abc', privateMessage('alice'))).toContain('金额格式不正确');
  });
});

describe('per-user isolation', () => {
  it('keeps each user’s entries, totals and ids separate', async () => {
    const { run } = await fixture();
    await run('记 午饭 20', privateMessage('alice'));
    await run('记 打车 30', privateMessage('alice'));
    expect(await run('记 咖啡 15', privateMessage('bob'))).toBe('✅ 已记账 #1 · 咖啡 ¥15.00');
    const aliceMonth = await run('本月消费', privateMessage('alice'));
    expect(aliceMonth).toContain('合计 ¥50.00 · 2 笔');
    expect(aliceMonth).not.toContain('咖啡');
    const bobMonth = await run('本月消费', privateMessage('bob'));
    expect(bobMonth).toContain('合计 ¥15.00 · 1 笔');
    expect(bobMonth).not.toContain('午饭');
  });

  it('treats the same sender id on another bot account as another ledger', async () => {
    const { run } = await fixture();
    await run('记 午饭 20', privateMessage('alice'));
    const otherBot = privateMessage('alice', { adapter: 'sandbox', id: 'other-bot' });
    expect(await run('本月消费', otherBot)).toContain('还没有记账');
  });
});

describe('group privacy', () => {
  it('masks the amount when recording in a group', async () => {
    const { run } = await fixture();
    const reply = await run('记 午饭 18.5', groupMessage('alice'));
    expect(reply).toBe('✅ 已记账 #1 · 午饭 ¥***');
    expect(reply).not.toContain('18.5');
  });

  it('sends summaries privately and tells the group only that it did', async () => {
    const created = await fixture();
    await created.run('记 午饭 18.5', groupMessage('alice'));
    const reply = await created.run('本周消费', groupMessage('alice'));
    expect(reply).toBe('🔒 本周消费已私信发送给你');
    const privateMessages = created.privateMessagesTo('alice');
    expect(privateMessages).toHaveLength(1);
    expect(privateMessages[0]).toContain('合计 ¥18.50 · 1 笔');
    const target = (created.fake.sent.at(-1)!.input as { target: unknown }).target;
    expect(target).toEqual({ endpoint: ENDPOINT, kind: 'private', id: 'alice' });
  });

  it('delivers to the saved private conversation when its id differs from the user id', async () => {
    const created = await fixture();
    const dm = { conversation: { endpoint: ENDPOINT, kind: 'private', id: 'dm-channel-9' }, sender: { id: 'alice' }, content: '' } as CommandMessage;
    await created.run('记 午饭 18.5', dm);

    expect(await created.run('本周消费', groupMessage('alice'))).toBe('🔒 本周消费已私信发送给你');
    const target = (created.fake.sent.at(-1)!.input as { target: unknown }).target;
    expect(target).toEqual({ endpoint: ENDPOINT, kind: 'private', id: 'dm-channel-9' });

    expect(await created.run('记账日报 开启', groupMessage('alice'))).toContain('已开启记账日报');
    await created.clock.advance(12 * 3_600_000);
    const reportTarget = (created.fake.sent.at(-1)!.input as { target: unknown }).target;
    expect(reportTarget).toEqual({ endpoint: ENDPOINT, kind: 'private', id: 'dm-channel-9' });
  });

  it('falls back to masked amounts when the private message cannot be delivered', async () => {
    const created = await fixture();
    await created.run('记 午饭 18.5', groupMessage('alice'));
    created.fake.outboundHost.failNext(new Error('cannot message group members privately'));
    const reply = await created.run('分类统计', groupMessage('alice'));
    expect(reply).toContain('午饭：1 笔，金额已隐藏');
    expect(reply).toContain('私聊我可查看完整金额');
    expect(reply).not.toMatch(/18\.5|¥\d/u);
  });

  it('masks amounts when the platform has no proactive outbound at all', async () => {
    const created = await fixture({ outbound: false });
    await created.run('记 午饭 18.5', groupMessage('alice'));
    const reply = await created.run('账单', groupMessage('alice'));
    expect(reply).toContain('#1');
    expect(reply).toContain('午饭 ¥***');
    expect(reply).not.toContain('18.50');
  });

  it('shows full amounts in a private chat', async () => {
    const { run } = await fixture();
    await run('记 午饭 18.5', privateMessage('alice'));
    expect(await run('账单', privateMessage('alice'))).toContain('#1 10-21 午饭 ¥18.50');
  });
});

describe('deleting entries', () => {
  it('only deletes the caller’s own entries', async () => {
    const { run } = await fixture();
    await run('记 午饭 20', privateMessage('alice'));
    await run('记 晚饭 40', privateMessage('alice'));
    await run('记 咖啡 15', privateMessage('bob'));
    expect(await run('删账 2', privateMessage('bob'))).toContain('没有找到你的账目 #2');
    expect(await run('本月消费', privateMessage('alice'))).toContain('合计 ¥60.00 · 2 笔');
    expect(await run('删账 1', privateMessage('bob'))).toBe('🗑️ 已删除 #1 · 咖啡 ¥15.00');
    expect(await run('本月消费', privateMessage('alice'))).toContain('合计 ¥60.00 · 2 笔');
    expect(await run('删账 1', groupMessage('alice'))).toBe('🗑️ 已删除 #1 · 午饭 ¥***');
    expect(await run('本月消费', privateMessage('alice'))).toContain('合计 ¥40.00 · 1 笔');
    expect(await run('删账 1', privateMessage('alice'))).toContain('没有找到');
  });

  it('never reuses an id after deletion', async () => {
    const { run } = await fixture();
    await run('记 午饭 20', privateMessage('alice'));
    await run('删账 1', privateMessage('alice'));
    expect(await run('记 午饭 21', privateMessage('alice'))).toContain('#2');
  });
});

describe('period boundaries in the configured timezone', () => {
  it('computes ISO weeks starting on Monday', () => {
    expect(weekStartKey('2026-10-19')).toBe('2026-10-19');
    expect(weekStartKey('2026-10-25')).toBe('2026-10-19');
    expect(weekStartKey('2026-10-18')).toBe('2026-10-12');
    expect(weekStartKey('2027-01-01')).toBe('2026-12-28');
  });

  it('splits today, this week and this month at local midnight', async () => {
    const { run, clock } = await fixture();
    const entries: Array<[number, string]> = [
      [shanghai(2026, 9, 30, 23, 59, 59), '九月末'],
      [shanghai(2026, 10, 1, 0, 0, 0), '十月初'],
      [shanghai(2026, 10, 18, 23, 59, 59), '上周日'],
      [shanghai(2026, 10, 19, 0, 0, 0), '本周一'],
      [shanghai(2026, 10, 20, 23, 59, 59), '昨天'],
      [shanghai(2026, 10, 21, 0, 0, 0), '今天'],
    ];
    for (const [time, category] of entries) {
      clock.set(time);
      await run(`记 ${category} 1`, privateMessage('alice'));
    }
    clock.set(WEDNESDAY_10_00_SHANGHAI);
    const today = await run('今日消费', privateMessage('alice'));
    expect(today).toContain('合计 ¥1.00 · 1 笔');
    expect(today).toContain('今天');
    const week = await run('本周消费', privateMessage('alice'));
    expect(week).toContain('2026-10-19 ~ 2026-10-25');
    expect(week).toContain('合计 ¥3.00 · 3 笔');
    expect(week).not.toContain('上周日');
    const month = await run('本月消费', privateMessage('alice'));
    expect(month).toContain('合计 ¥5.00 · 5 笔');
    expect(month).not.toContain('九月末');
    expect(await run('分类统计 全部', privateMessage('alice'))).toContain('共 6 个类别');
  });

  it('uses the configured timezone, not the server timezone', () => {
    const lateEveningUtc = Date.UTC(2026, 9, 20, 17, 0, 0);
    expect(localDateKey(lateEveningUtc, 'Asia/Shanghai')).toBe('2026-10-21');
    expect(localDateKey(lateEveningUtc, 'UTC')).toBe('2026-10-20');
    const now = Date.UTC(2026, 9, 21, 2, 0, 0);
    expect(isInPeriod(lateEveningUtc, now, 'today', 'Asia/Shanghai')).toBe(true);
    expect(isInPeriod(lateEveningUtc, now, 'today', 'UTC')).toBe(false);
  });

  it('rejects an unknown period word', async () => {
    const { run } = await fixture();
    expect(await run('账单 去年', privateMessage('alice'))).toContain('今日、本周、本月、全部');
  });
});

describe('opt-in daily report (FakeClock)', () => {
  it('sends each subscriber one private report per day at reportTime', async () => {
    const created = await fixture();
    expect(await created.run('记账日报 开启', privateMessage('alice'))).toContain('已开启记账日报');
    await created.run('记 午饭 20', privateMessage('alice'));
    await created.run('记 晚饭 35.5', privateMessage('alice'));
    await created.run('记 咖啡 15', privateMessage('bob'));

    await created.clock.advance(11 * 3_600_000 + 59 * 60_000);
    expect(created.privateMessagesTo('alice')).toEqual([]);

    await created.clock.advance(60_000);
    const reports = created.privateMessagesTo('alice');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('🌙 记账日报');
    expect(reports[0]).toContain('合计 ¥55.50 · 2 笔');
    expect(created.privateMessagesTo('bob')).toEqual([]);

    await created.clock.advance(90 * 60_000);
    expect(created.privateMessagesTo('alice')).toHaveLength(1);
  });

  it('skips empty days unless reportWhenEmpty is set, and stops after opting out', async () => {
    const created = await fixture();
    await created.run('记账日报 开启', privateMessage('alice'));
    await created.clock.advance(12 * 3_600_000);
    expect(created.privateMessagesTo('alice')).toEqual([]);

    await created.clock.advance(14 * 3_600_000);
    await created.run('记 早饭 8', privateMessage('alice'));
    await created.clock.advance(10 * 3_600_000);
    expect(created.privateMessagesTo('alice')).toHaveLength(1);

    expect(await created.run('记账日报 关闭', privateMessage('alice'))).toBe('已关闭记账日报');
    await created.clock.advance(2 * 3_600_000);
    await created.run('记 早饭 8', privateMessage('alice'));
    await created.clock.advance(22 * 3_600_000);
    expect(created.privateMessagesTo('alice')).toHaveLength(1);
    expect(await created.run('记账日报', privateMessage('alice'))).toContain('未开启');
  });

  it('sends an empty-day report when configured', async () => {
    const created = await fixture({ config: { timezone: 'Asia/Shanghai', reportTime: '22:00', reportWhenEmpty: true } });
    await created.run('记账日报 开启', privateMessage('alice'));
    await created.clock.advance(12 * 3_600_000);
    expect(created.privateMessagesTo('alice')).toEqual(['🌙 记账日报\n📒 今日还没有记账（2026-10-21）']);
  });

  it('does not send today’s report right away when opting in after reportTime', async () => {
    const created = await fixture();
    created.clock.set(shanghai(2026, 10, 21, 23, 0));
    await created.run('记 夜宵 30', privateMessage('alice'));
    await created.run('记账日报 开启', privateMessage('alice'));
    await created.clock.advance(5 * 60_000);
    expect(created.privateMessagesTo('alice')).toEqual([]);
  });

  it('confirms a group opt-in by private message and refuses when the user cannot be reached', async () => {
    const created = await fixture();
    expect(await created.run('记账日报 开启', groupMessage('alice'))).toBe('🔒 已开启记账日报，确认消息已私信发送给你');
    expect(created.privateMessagesTo('alice')[0]).toContain('已开启记账日报');
    expect(await created.run('记账日报 状态', groupMessage('alice'))).toContain('已开启');

    created.fake.outboundHost.failNext(new Error('unreachable'));
    expect(await created.run('记账日报 开启', groupMessage('bob'))).toContain('无法私信你');
    expect(await created.run('记账日报', privateMessage('bob'))).toContain('未开启');
  });

  it('refuses to opt in without proactive outbound', async () => {
    const created = await fixture({ outbound: false });
    expect(await created.run('记账日报 开启', privateMessage('alice'))).toContain('不支持主动私信');
  });
});

describe('databases created before the private target table existed', () => {
  const LEGACY_USER_COLUMNS = ['owner_key', 'next_seq', 'report_enabled', 'report_target', 'last_report_date'];

  it('declares its new nullable locale column before reading old users', async () => {
    const created = await fixture();
    const database = created.fake.database;
    const availableColumns = [...LEGACY_USER_COLUMNS];
    const check = (names: readonly string[]) => {
      const unknown = names.filter((name) => !availableColumns.includes(name));
      if (unknown.length > 0) throw new Error(`no such column: ${unknown.join(', ')}`);
    };
    const strict = {
      define: (name: string, definition: Record<string, unknown>, options?: { addColumns: readonly string[] }) => {
        if (name === USER_TABLE) {
          expect(options?.addColumns).toEqual(['report_locale']);
          expect(definition.report_locale).toMatchObject({ nullable: true });
          availableColumns.push(...options!.addColumns);
        }
        database.define(name, definition);
      },
      models: {
        get(name: string) {
          const model = database.models.get(name);
          if (!model || name !== USER_TABLE) return model;
          return {
            select: (...columns: string[]) => { check(columns); return model.select(...columns); },
            insert: (row: Record<string, unknown>) => { check(Object.keys(row)); return model.insert(row); },
            update: (patch: Record<string, unknown>) => { check(Object.keys(patch)); return model.update(patch); },
            delete: () => model.delete(),
          };
        },
      },
    } as unknown as ConstructorParameters<typeof LedgerService>[0];
    defineLedgerTables(strict);
    const outbound = created.fake.resources.use(outboundHostToken);
    const service = new LedgerService(strict, outbound, resolveLedgerConfig({ timezone: 'Asia/Shanghai', reportTime: '22:00' }));
    const dm = { conversation: { endpoint: ENDPOINT, kind: 'private', id: 'dm-7' }, sender: { id: 'alice' }, content: '' } as CommandMessage;
    const group = groupMessage('alice');

    await service.dailyReport(ledgerCaller(dm), 'on');
    await service.addEntry(ledgerCaller(dm), '午饭 18.5');
    expect(await service.periodSummary(ledgerCaller(group), 'week')).toBe('🔒 本周消费已私信发送给你');
    const target = (created.fake.sent.at(-1)!.input as { target: unknown }).target;
    expect(target).toEqual({ endpoint: ENDPOINT, kind: 'private', id: 'dm-7' });
  });
});


describe('localized ledger commands and pinned report language', () => {
  it('uses English inputs and feedback while keeping amounts private and reports pinned', async () => {
    const created = await fixture();
    const english = { ...privateMessage('alice'), locale: 'en' as const };
    const sendTarget = vi.spyOn(created.fake.outbound, 'sendTarget');
    expect(await created.run('ledger-add Lunch 18.5', english)).toContain('Recorded #1');
    expect(await created.run('ledger-list today', english)).toContain('Today entries');
    expect(await created.run('ledger-list 今日', english)).toContain('Choose a period');
    expect(await created.run('ledger-report 开启', english)).toContain('Choose an action');
    expect(await created.run('ledger-report on', english)).toContain('Daily reports enabled');
    expect(await created.run('ledger-today', { ...groupMessage('alice'), locale: 'en' })).toContain('sent to you privately');
    expect(sendTarget.mock.calls.at(-1)).toEqual([expect.objectContaining({ id: 'alice' }), expect.any(String), { locale: 'en' }]);
    expect(await created.run('ledger-report 状态', privateMessage('alice'))).toContain('已开启');
    await created.clock.advance(12 * 60 * 60_000);
    const report = created.privateMessagesTo('alice').at(-1)!;
    expect(report).toContain('Daily expense report');
    expect(report).toContain('¥18.50');
    expect(report).not.toContain('记账日报');
    expect(sendTarget.mock.calls.at(-1)).toEqual([expect.objectContaining({ id: 'alice' }), expect.any(String), { locale: 'en' }]);
  });
});
