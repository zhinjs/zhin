import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { teachAdd } from '../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '教我问答（teach 问题 回答 或 问题|答案）',
  execute({ config, input, args, owner, use }) {
    return teachAdd(input ?? {}, resolveGroupSuiteConfig(config), args.join(' '), false, resolveGroupSuiteRuntime({ owner, use }));
  },
});
