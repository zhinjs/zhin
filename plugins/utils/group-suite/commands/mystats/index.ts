import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { myStatsText } from '../../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看个人消息统计', descriptionI18n: { en: "View your message statistics" },
  execute({ input, owner, use, locale, formatCommand }) {
    return myStatsText({ ...input, locale }, resolveGroupSuiteRuntime({ owner, use }));
  },
});
