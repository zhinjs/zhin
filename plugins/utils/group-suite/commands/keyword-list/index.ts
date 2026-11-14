import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { keywordsForCommand } from '../../src/keywords.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()'],
  description: '查看当前群关键词回复对（包含匹配；teach 问答见 teach-list）', descriptionI18n: { en: "List this group's keyword replies (contains match; teach Q&A pairs are in teach-list)" },
  async execute(context) {
    const repository = keywordsForCommand(context.input, context);
    if (typeof repository === 'string') return repository;
    const entries = await repository.read();
    const hint = t(context.locale, 'keywordOtherSystem');
    if (entries.length === 0) return `${t(context.locale, 'keywordEmpty')}\n${hint}`;
    const lines = entries.map(([k, v], i) => `${i + 1}. 「${k}」→「${v}」`);
    return t(context.locale, 'keywordList', { count: entries.length, lines: lines.join('\n'), hint });
  },
});
