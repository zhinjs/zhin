import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../../src/config.js';
import { teachList } from '../../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看问答列表', descriptionI18n: { en: "List learned questions and answers" },
  params: { page: { type: 'number', default: 1 } },
  execute({ config, input, params, owner, use, locale }) {
    const page = Number(params.page ?? 1);
    return teachList({ ...input, locale }, resolveGroupSuiteConfig(config), page, resolveGroupSuiteRuntime({ owner, use }));
  },
});
