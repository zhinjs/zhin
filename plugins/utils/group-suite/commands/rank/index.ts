import { defineCommand } from 'zhin.js/command';
import type { Message, SendContent } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { pointsRank } from '../../src/checkin-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, SendContent, Message>({
  description: '查看积分排行榜', descriptionI18n: { en: "View the points leaderboard" },
  alias: ['checkin rank', '积分排行'],
  execute({ config, input, owner, use, has, locale }) {
    return pointsRank({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), resolveGroupSuiteRuntime({ owner, use }));
  },
});
