import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { teachAdd } from '../../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  permit: ['group()', 'trusted'],
  description: '教我问答（teach 问题 回答 或 问题|答案）：整条消息与问题完全一致才回复，与 keyword-add 的「包含关键词」不同', descriptionI18n: { en: "Teach a Q&A pair: replies only when the whole message equals the question (keyword-add matches any message containing the keyword)" },
  execute({ config, input, args, owner, use, has, locale }) {
    return teachAdd({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), args.join(' '), false, resolveGroupSuiteRuntime({ owner, use }));
  },
});
