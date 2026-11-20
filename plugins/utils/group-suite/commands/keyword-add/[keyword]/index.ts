import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message, SendContent } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../../src/config.js';
import { keywordsForCommand } from '../../../src/keywords.js';
import { echoReply } from '../../../src/echo.js';

export default defineCommand<GroupSuiteConfig, SendContent, Message>({
  permit: ['group()', 'trusted'],
  description: '添加当前群关键词自动回复：消息包含关键词即回复（需开启 keywordReply）；整句问答用 teach', descriptionI18n: { en: "Add a keyword reply in this group: replies when a message contains the keyword (needs keywordReply); use teach for whole-message Q&A" },
  alias: ['keyword add'],
  preferredAliasI18n: { 'zh-CN': 'keyword add', en: 'keyword add' },
  params: { keyword: { type: 'string' } },
  async execute(context) {
    const keyword = String(context.params.keyword ?? '');
    const reply = context.args.join(' ').trim();
    if (!keyword || !reply) return t(context.locale, 'keywordRequired');
    const repository = keywordsForCommand(context.input, context);
    if (typeof repository === 'string') return repository;
    await repository.update(store => { store.set(keyword, reply); });
    // The stored reply is a template for the auto-reply; quoted here it is shown as written.
    return echoReply(mark => t(context.locale, 'keywordAdded', { keyword: mark(keyword), reply: mark(reply) }));
  },
});
