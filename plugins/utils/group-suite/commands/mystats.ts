import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../src/config.js';
import { myStatsText } from '../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看个人消息统计',
  execute({ input, owner, use }) {
    return myStatsText(input ?? {}, resolveGroupSuiteRuntime({ owner, use }));
  },
});
