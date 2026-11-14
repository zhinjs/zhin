import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { teachAdd } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'trusted'],
  description: '教我正则问答（需开启 teachAllowRegex；属于 teach 问答，不是 keyword 关键词回复）', descriptionI18n: { en: "Teach a regular-expression Q&A pair (needs teachAllowRegex; part of teach Q&A, not keyword replies)" },
  alias: ['teach regex'],
  preferredAliasI18n: { 'zh-CN': 'teach regex', en: 'teach regex' },
  execute({ config, input, args, owner, use, has, locale }) {
    return teachAdd({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), args.join(' '), true, resolveGroupSuiteRuntime({ owner, use }));
  },
});
