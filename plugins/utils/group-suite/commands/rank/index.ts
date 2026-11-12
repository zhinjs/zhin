import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { pointsRank } from '../../src/checkin-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看积分排行榜', descriptionI18n: { en: "View the points leaderboard" },
  alias: ['checkin rank'],
  execute({ config, input, owner, use, has, locale }) {
    return pointsRank({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), resolveGroupSuiteRuntime({ owner, use }));
  },
});
