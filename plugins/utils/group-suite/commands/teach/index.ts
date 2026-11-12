import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { teachAdd } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'trusted'],
  description: '教我问答（teach 问题 回答 或 问题|答案）', descriptionI18n: { en: "Teach a question and answer pair" },
  execute({ config, input, args, owner, use, has, locale }) {
    return teachAdd({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), args.join(' '), false, resolveGroupSuiteRuntime({ owner, use }));
  },
});
