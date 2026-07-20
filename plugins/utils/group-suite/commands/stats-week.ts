import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { resolveGroupId, statsRankText, weekStartStr } from '../src/stats-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看本周消息统计',
  execute({ config, input }) {
    const groupId = resolveGroupId(input ?? {});
    const title = groupId ? '本周本群消息统计' : '本周全局消息统计';
    return statsRankText(
      input ?? {},
      resolveGroupSuiteConfig(config),
      weekStartStr(),
      title,
    );
  },
});
