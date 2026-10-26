import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../../src/config.js';
import { keywordsForCommand } from '../../../src/keywords.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'role(owner,admin,master,trusted)'],
  description: '删除当前群关键词自动回复', descriptionI18n: { en: "Delete a keyword reply in this group" },
  params: { keyword: { type: 'string' } },
  async execute(context) {
    const keyword = String(context.params.keyword ?? '');
    if (!keyword) return t(context.locale, 'keywordRemoveRequired');
    const repository = keywordsForCommand(context.input, context);
    if (typeof repository === 'string') return repository;
    if (!(await repository.read()).some(([entry]) => entry === keyword)) return t(context.locale, 'keywordMissing', { keyword });
    await repository.update(store => { store.delete(keyword); });
    return t(context.locale, 'keywordRemoved', { keyword });
  },
});
