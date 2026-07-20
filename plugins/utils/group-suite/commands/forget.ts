import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../src/config.js';
import { teachForget } from '../src/teach-lib.js';
import { resolveGroupSuiteRuntime } from '../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '忘记问答（删除问答对）',
  execute({ input, args, owner, use }) {
    return teachForget(input ?? {}, args.join(' '), resolveGroupSuiteRuntime({ owner, use }));
  },
});
