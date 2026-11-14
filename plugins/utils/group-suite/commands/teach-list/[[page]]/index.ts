import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../../src/config.js';
import { teachList } from '../../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看 teach 问答列表（整句匹配；关键词回复见 keyword-list）', descriptionI18n: { en: "List teach Q&A pairs (whole-message match; keyword replies are in keyword-list)" },
  params: { page: { type: 'number', default: 1 } },
  execute({ config, input, params, owner, use, has, locale }) {
    const page = Number(params.page ?? 1);
    return teachList({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), page, resolveGroupSuiteRuntime({ owner, use }));
  },
});
