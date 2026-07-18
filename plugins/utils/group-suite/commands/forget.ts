import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../src/config.js';
import { teachForget } from '../src/teach-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '忘记问答（删除问答对）',
  execute({ input, args }) {
    return teachForget(input ?? {}, args.join(' '));
  },
});
