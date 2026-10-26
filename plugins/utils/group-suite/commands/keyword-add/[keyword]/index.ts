import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../../src/config.js';
import { keywordsForCommand } from '../../../src/keywords.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'role(owner,admin,master,trusted)'],
  description: '添加当前群关键词自动回复', descriptionI18n: { en: "Add a keyword reply in this group" },
  params: { keyword: { type: 'string' } },
  async execute(context) {
    const keyword = String(context.params.keyword ?? '');
    const reply = context.args.join(' ').trim();
    if (!keyword || !reply) return t(context.locale, 'keywordRequired');
    const repository = keywordsForCommand(context.input, context);
    if (typeof repository === 'string') return repository;
    await repository.update(store => { store.set(keyword, reply); });
    return t(context.locale, 'keywordAdded', { keyword, reply });
  },
});
