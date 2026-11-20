// zhinjs/zhin#1250: taught answers are outbound templates; user text (captures, nicknames) is data.
import { componentHostToken, type RuntimeSnapshot } from '../../../../packages/im/plugin-runtime/src/index.js';
import { renderTemplatePaths } from '../../../../packages/im/kernel/src/index.js';
import { OutboundRenderer, type SendContent } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig } from '../src/config.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import { createGroupSuiteRuntime } from '../src/runtime-state.js';
import { teachAdd, tryTeachReply } from '../src/teach-lib.js';
import { hintWelcomePrefix, resetWelcomePrefixHints, welcomeNeedsPrefixHint } from '../src/welcome-template.js';

const input = {
  locale: 'zh-CN' as const,
  content: '',
  conversation: { kind: 'group' as const, id: 'g1', endpoint: { adapter: 'sandbox', id: 'bot' } },
  sender: { id: 'u1', name: '${menu}{sender}' },
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
    expect(await render(reply!)).toBe('你好 ${menu}{sender}（u1）{sender} {sender.id}');
  });

  it('fills ${time} / ${date} locally in one pass and leaves {time} / {date} literal', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 20, 8, 30, 0));
    try {
      await teachAdd(input, config, '几点|现在 ${time}，今天 ${ date } {time} {date}', false, runtime);
      const reply = await tryTeachReply({ ...input, content: '几点' }, config, runtime);
      const now = new Date();
      expect(reply).toBe(`现在 ${now.toLocaleTimeString('zh-CN')}，今天 ${now.toLocaleDateString('zh-CN')} {time} {date}`);
    } finally { vi.useRealTimers(); }
  });

  it('never expands placeholders inside a regex capture', async () => {
    const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
    await teachAdd(input, config, '^说(.+)$|你说了 $1，$2 ${sender.id}', true, runtime);
    const reply = await tryTeachReply({ ...input, content: '说${menu}${time}{sender}' }, config, runtime);
    expect(await render(reply!)).toBe('你说了 ${menu}${time}{sender}，$2 u1');
  });
});

describe('group-suite welcome · bare menu word hint', () => {
  it('flags a bare menu word only when the account has a prefix and the text uses no ${menu} / ${prefix}', () => {
    expect(welcomeNeedsPrefixHint('欢迎！发送菜单查看功能', '#')).toBe(true);
    expect(welcomeNeedsPrefixHint('welcome, type help', '/')).toBe(true);
    expect(welcomeNeedsPrefixHint('欢迎！发送菜单查看功能', '')).toBe(false);
    expect(welcomeNeedsPrefixHint('欢迎！发送 #菜单 查看功能', '#')).toBe(false);
    expect(welcomeNeedsPrefixHint('欢迎！发送 ${menu} 查看功能（菜单）', '#')).toBe(false);
    expect(welcomeNeedsPrefixHint('欢迎！${prefix}帮助', '#')).toBe(false);
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
      hintWelcomePrefix('bot-c', '发送 ${menu}', '/');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0]![0])).toContain('zhin doctor');
    } finally { warn.mockRestore(); }
  });
});
