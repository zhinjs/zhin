import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../../src/config.js';
import { teachList } from '../../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看问答列表', descriptionI18n: { en: "List learned questions and answers" },
  params: { page: { type: 'number', default: 1 } },
  execute({ config, input, params, owner, use, has, locale }) {
    const page = Number(params.page ?? 1);
    return teachList({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), page, resolveGroupSuiteRuntime({ owner, use }));
  },
});
