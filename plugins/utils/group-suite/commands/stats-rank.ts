import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { monthStartStr, resolveGroupId, statsRankText } from '../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看本月话唠排行',
  execute({ config, input, owner, use }) {
    const groupId = resolveGroupId(input ?? {});
    const title = groupId ? '本月话唠排行' : '全局话唠排行';
    return statsRankText(
      input ?? {},
      resolveGroupSuiteConfig(config),
      monthStartStr(),
      title,
      resolveGroupSuiteRuntime({ owner, use }),
    );
  },
});
