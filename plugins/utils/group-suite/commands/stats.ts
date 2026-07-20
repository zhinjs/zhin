import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { todayStr } from '../src/shared-runtime.js';
import { resolveGroupId, statsRankText } from '../src/stats-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看今日消息统计',
  execute({ config, input }) {
    const groupId = resolveGroupId(input ?? {});
    const title = groupId ? '今日本群消息统计' : '今日全局消息统计';
    return statsRankText(
      input ?? {},
      resolveGroupSuiteConfig(config),
      todayStr(),
      title,
    );
  },
});
