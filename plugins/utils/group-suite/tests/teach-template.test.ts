// zhinjs/zhin#1250: taught answers are outbound templates; user text (captures, nicknames) is data,
// and replies that quote stored questions, answers, keywords or nicknames show them as written.
import { componentHostToken, type RuntimeSnapshot } from '../../../../packages/im/plugin-runtime/src/index.js';
import { renderTemplatePaths } from '../../../../packages/im/kernel/src/index.js';
import { OutboundRenderer, type SendContent } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig } from '../src/config.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import { createGroupSuiteRuntime } from '../src/runtime-state.js';
import { teachAdd, teachForget, teachList, tryTeachReply } from '../src/teach-lib.js';
import { hintLegacyPlaceholders, hintWelcomePrefix, legacyPlaceholders, resetWelcomePrefixHints, welcomeNeedsPrefixHint } from '../src/welcome-template.js';
import { groupSuiteSendsWelcome } from '../src/welcome-scope.js';
import { doCheckin, myPoints, pointsRank } from '../src/checkin-lib.js';
import { myStatsText, recordMessage, statsRankText } from '../src/stats-lib.js';
import keywordAdd from '../commands/keyword-add/[keyword]/index.ts';
import keywordList from '../commands/keyword-list/index.ts';
import keywordRemove from '../commands/keyword-remove/[keyword]/index.ts';

const input = {
  locale: 'zh-CN' as const,
  content: '',
  conversation: { kind: 'group' as const, id: 'g1', endpoint: { adapter: 'sandbox', id: 'bot' } },
  sender: { id: 'u1', name: '${bot.menu}{sender}' },
};
const config = resolveGroupSuiteConfig({ teachAllowRegex: true, teachCooldownMs: 0 });

/** Render through the real OutboundRenderer, with the Component Host the instance installs. */
async function render(content: SendContent): Promise<string> {
  const snapshot = { root: 'root', projections: new Map(), capabilities: new Map(), config: new Map(),
    resources: new Map([['root', new Map([[componentHostToken.id, { compileTemplate: (text: string, ctx: object) => renderTemplatePaths(text, { ...ctx }) }]])]]),
  } as unknown as RuntimeSnapshot;
  const rendered = await new OutboundRenderer().render(content, { requester: 'plugin:group-suite' as never, snapshot,
    conversation: input.conversation, incoming: { sender: input.sender, content: 'x', timestamp: 1 } });
  return (Array.isArray(rendered) ? rendered : [rendered]).map(item => String(item)).join('');
}

describe('group-suite teach answers · outbound template', () => {
  it('fills ${sender.*} from the incoming message as data and leaves the old {sender} literal', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    await teachAdd(input, config, '你好|你好 ${sender.name}（${sender.id}）{sender} {sender.id}', false, runtime);
    const reply = await tryTeachReply({ ...input, content: '你好' }, config, runtime);
    expect(reply).toBe('你好 ${sender.name}（${sender.id}）{sender} {sender.id}');
    expect(await render(reply!)).toBe('你好 ${bot.menu}{sender}（u1）{sender} {sender.id}');
  });

  it('fills ${now.time} / ${now.date} locally in one pass and leaves {time} / {date} / ${time} literal', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 20, 8, 30, 0));
    try {
      await teachAdd(input, config, '几点|现在 ${now.time}，今天 ${ now.date } {time} {date} ${time}', false, runtime);
      const reply = await tryTeachReply({ ...input, content: '几点' }, config, runtime);
      const now = new Date();
      expect(reply).toBe(`现在 ${now.toLocaleTimeString('zh-CN')}，今天 ${now.toLocaleDateString('zh-CN')} {time} {date} ${'$'}{time}`);
    } finally { vi.useRealTimers(); }
  });

  it('never expands placeholders inside a regex capture', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    await teachAdd(input, config, '^说(.+)$|你说了 $1，$2 ${sender.id}', true, runtime);
    const reply = await tryTeachReply({ ...input, content: '说${bot.menu}${now.time}{sender}' }, config, runtime);
    expect(await render(reply!)).toBe('你说了 ${bot.menu}${now.time}{sender}，$2 u1');
  });
});

describe('group-suite welcome · bare menu word hint', () => {
  it('flags a bare menu word only when the account has a prefix and the text uses no ${bot.menu} / ${bot.prefix}', () => {
    expect(welcomeNeedsPrefixHint('欢迎！发送菜单查看功能', '#')).toBe(true);
    expect(welcomeNeedsPrefixHint('welcome, type help', '/')).toBe(true);
    expect(welcomeNeedsPrefixHint('欢迎！发送菜单查看功能', '')).toBe(false);
    expect(welcomeNeedsPrefixHint('欢迎！发送 #菜单 查看功能', '#')).toBe(false);
    expect(welcomeNeedsPrefixHint('欢迎！发送 ${bot.menu} 查看功能（菜单）', '#')).toBe(false);
    expect(welcomeNeedsPrefixHint('欢迎！${bot.prefix}帮助', '#')).toBe(false);
    expect(welcomeNeedsPrefixHint('a helpful menuitem', '#')).toBe(false);
  });

  it('warns once per account and text', async () => {
    const { getLogger } = await import('zhin.js');
    const warn = vi.spyOn(getLogger('group-suite'), 'warn');
    resetWelcomePrefixHints();
    try {
      hintWelcomePrefix('bot-a', '发送菜单', '#');
      hintWelcomePrefix('bot-a', '发送菜单', '#');
      hintWelcomePrefix('bot-b', '发送菜单', '/');
      hintWelcomePrefix('bot-c', '发送 ${bot.menu}', '/');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0]![0])).toContain('zhin doctor');
    } finally { warn.mockRestore(); }
  });
});

describe('group-suite replies quote stored data literally (#1250)', () => {
  const admin = { ...input, sender: { id: 'u1', name: 'Admin' } };
  async function renderAs(content: SendContent, name = 'Admin'): Promise<string> {
    const snapshot = { root: 'root', projections: new Map(), capabilities: new Map(), config: new Map(),
      resources: new Map([['root', new Map([[componentHostToken.id, { compileTemplate: (text: string, ctx: object) => renderTemplatePaths(text, { ...ctx }) }]])]]),
    } as unknown as RuntimeSnapshot;
    const rendered = await new OutboundRenderer().render(content, { requester: 'plugin:group-suite' as never, snapshot,
      conversation: input.conversation, incoming: { sender: { id: 'u1', name }, content: 'x', timestamp: 1 } });
    return (Array.isArray(rendered) ? rendered : [rendered])
      .map(item => typeof item === 'string' ? item : String((item as { data?: { text?: string } }).data?.text ?? '')).join('');
  }

  it('teach confirmations, the list and forget show the answer as written, the reply still fills it', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    expect(await renderAs(await teachAdd(admin, config, '你好|你好 ${sender.name}', false, runtime)))
      .toBe('学会了！发送「你好」我会回复「你好 ${sender.name}」');
    expect(await renderAs(await teachAdd(admin, config, '你好|你好 ${sender.name} ${bot.menu}', false, runtime)))
      .toBe('已更新问答：「你好」→「你好 ${sender.name} ${bot.menu}」');
    expect(await renderAs(await teachAdd(admin, config, '^${sender.id}$|${sender.name}', true, runtime)))
      .toBe('学会了！匹配 /^${sender.id}$/ 的消息我会回复「${sender.name}」');
    const listed = await renderAs(await teachList(admin, config, 1, runtime));
    expect(listed).toContain('你好 → 你好 ${sender.name} ${bot.menu}');
    expect(listed).toContain('/^${sender.id}$/ → ${sender.name}');
    expect(await renderAs((await tryTeachReply({ ...admin, content: '你好' }, config, runtime))!)).toBe('你好 Admin ${bot.menu}');
    expect(await renderAs(await teachForget(admin, '${sender.name}', runtime))).toBe('没有找到问题「${sender.name}」');
  });

  it('an invalid pattern\'s error quotes the pattern literally', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    expect(await renderAs(await teachAdd(admin, config, '(${sender.name}|x', true, runtime))).toContain('${sender.name}');
  });

  it('keyword confirmations and the keyword list quote keywords and replies literally', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const context = { input: admin, locale: 'zh-CN', config: { ephemeralKeywords: true }, owner: { id: 'plugin:group-suite' },
      use: () => runtime, has: () => false, args: ['回复 ${sender.name}'], params: { keyword: '${bot.menu}' } };
    expect(await renderAs(await keywordAdd.execute(context as never) as SendContent)).toBe('已添加关键词「${bot.menu}」→「回复 ${sender.name}」');
    expect(await renderAs(await keywordList.execute(context as never) as SendContent)).toContain('「${bot.menu}」→「回复 ${sender.name}」');
    expect(await renderAs(await keywordRemove.execute(context as never) as SendContent)).toBe('已删除关键词「${bot.menu}」');
  });

  it('nicknames in rankings and personal reports are data', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    const member = { ...input, sender: { id: 'u2', name: '${sender.id}${bot.menu}' } };
    await doCheckin(member, config, runtime);
    recordMessage(member, runtime);
    expect(await renderAs(await pointsRank(member, config, runtime))).toContain('${sender.id}${bot.menu}');
    expect(await renderAs(await myPoints(member, runtime))).toContain('${sender.id}${bot.menu} 的积分信息');
    expect(await renderAs(await statsRankText(member, config, '1970-01-01', '统计', runtime))).toContain('${sender.id}${bot.menu}');
    expect(await renderAs(await myStatsText(member, runtime))).toContain('${sender.id}${bot.menu} 的本群消息统计');
  });
});

describe('group-suite · old placeholders are reported, not migrated', () => {
  it('finds the old brace and single-name forms and maps each to its new path', () => {
    expect(legacyPlaceholders('欢迎 {name}（{id}）{sender.id} {time} ${menu} ${prefix}帮助 ${sender.name} ${bot.menu}')).toEqual([
      ['{name}', '${sender.name}'], ['{id}', '${sender.id}'], ['{sender.id}', '${sender.id}'], ['{time}', '${now.time}'],
      ['${menu}', '${bot.menu}'], ['${prefix}', '${bot.prefix}'],
    ]);
    expect(legacyPlaceholders('欢迎 ${sender.name}，发送 ${bot.menu}；${now.time} {other}')).toEqual([]);
  });

  it('warns once per account and text, for the welcome message and for a stored teach answer', async () => {
    const { getLogger } = await import('zhin.js');
    const warn = vi.spyOn(getLogger('group-suite'), 'warn');
    resetWelcomePrefixHints();
    try {
      hintLegacyPlaceholders('welcomeMessage', 'bot-a', '欢迎 {name}，发送 ${menu}');
      hintLegacyPlaceholders('welcomeMessage', 'bot-a', '欢迎 {name}，发送 ${menu}');
      hintLegacyPlaceholders('welcomeMessage', 'bot-a', '欢迎 ${sender.name}');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('{name} → ${sender.name}, ${menu} → ${bot.menu}');
      const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
      const at = { ...input, conversation: { ...input.conversation, endpoint: { adapter: 'sandbox', id: 'bot-b' } } };
      await teachAdd(at, config, '早|早上好 {sender}，现在 {time}', false, runtime);
      await tryTeachReply({ ...at, content: '早' }, config, runtime);
      await tryTeachReply({ ...at, content: '早' }, config, runtime);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1]![0])).toContain('teach answer for account bot-b');
      expect(String(warn.mock.calls[1]![0])).toContain('{time} → ${now.time}');
      expect(String(warn.mock.calls[1]![0])).not.toContain('早上好');
    } finally { warn.mockRestore(); }
  });

  it('checks a welcome text only where this plugin sends the welcome', () => {
    const conversation = input.conversation;
    const owner = (owns: boolean) => ({ has: () => true, use: () => ({ ownsWelcome: () => owns }) });
    expect(groupSuiteSendsWelcome({ has: () => false, use: () => { throw new Error('absent'); } } as never, undefined, conversation)).toBe(true);
    expect(groupSuiteSendsWelcome(owner(false) as never, undefined, conversation)).toBe(true);
    expect(groupSuiteSendsWelcome(owner(true) as never, undefined, conversation)).toBe(false);
    expect(groupSuiteSendsWelcome(owner(false) as never, [], conversation)).toBe(false);
  });
});
