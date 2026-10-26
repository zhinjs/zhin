import { readFileSync } from 'node:fs';
import type { Locale } from 'zhin.js/i18n';
import { parsePluginConfigSchema } from '../../../../packages/im/runtime/src/config-composer.js';
import inbound from '../middlewares/inbound/index.ts';
import { resolveModerationConfig } from '../src/config.js';
import { ModerationEngine } from '../src/engine.js';
import { moderationEngineToken } from '../src/runtime.js';

const schema = JSON.parse(readFileSync(new URL('../schema.json', import.meta.url), 'utf8'));
const oldDefault = '消息含不当内容，已拦截。';

describe('content moderation reply localization', () => {
  it.each([
    ['zh-CN', undefined, oldDefault],
    ['en', undefined, 'This message contains inappropriate content and was blocked.'],
    ['en', oldDefault, oldDefault],
    ['en', '自定义提示：{locale}，请联系管理员', '自定义提示：{locale}，请联系管理员'],
    ['zh-CN', 'My custom reply', 'My custom reply'],
  ] as const)('replies through inbound middleware in %s, explicit template: %s', async (locale, replyTemplate, expected) => {
    const raw = {
      ...(replyTemplate === undefined ? {} : { replyTemplate }),
      actions: { high: ['reply', 'drop'] },
      sources: [{ id: 'fixture', type: 'local', includeBuiltin: false, words: ['blocked-fixture'] }],
    };
    // The same validator as Runtime composition uses defaults; absence must survive that boundary.
    const parsed = parsePluginConfigSchema(schema, raw);
    expect(parsed.errors).toEqual([]);
    if (replyTemplate === undefined) {
      expect(parsed.value).not.toHaveProperty('replyTemplate');
      expect(resolveModerationConfig(parsed.value)).not.toHaveProperty('replyTemplate');
    } else expect(parsed.value).toHaveProperty('replyTemplate', replyTemplate);

    const engine = new ModerationEngine();
    engine.configure(parsed.value);
    const reply = vi.fn(async () => undefined);
    const next = vi.fn(async () => undefined);
    const input = { locale: locale as Locale, content: 'blocked-fixture', segments: [], sender: { id: 'u1' },
      metadata: { locale: locale === 'en' ? 'zh-CN' : 'en' },
      conversation: { endpoint: { adapter: 'fixture', id: 'canonical-bot' }, kind: 'group', id: 'g1' },
      $reply: reply };
    await inbound.handle({ config: parsed.value, input,
      use: (token: { id: string }) => {
        if (token.id !== moderationEngineToken.id) throw new Error('Unexpected resource');
        return engine;
      },
    } as never, next as never);
    expect(reply).toHaveBeenCalledExactlyOnceWith(expected);
    expect(next).not.toHaveBeenCalled();
  });
});
