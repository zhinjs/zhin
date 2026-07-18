import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { teachAdd } from '../src/teach-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '教我正则问答',
  execute({ config, input, args }) {
    return teachAdd(input ?? {}, resolveGroupSuiteConfig(config), args.join(' '), true);
  },
});
