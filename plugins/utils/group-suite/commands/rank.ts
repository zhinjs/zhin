import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { pointsRank } from '../src/checkin-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看积分排行榜',
  execute({ config, input }) {
    return pointsRank(input ?? {}, resolveGroupSuiteConfig(config));
  },
});
