import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { resolveGroupId, statsRankText, weekStartStr } from '../../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看本周消息统计', descriptionI18n: { en: "View this week's message statistics" },
  alias: ['stats week'],
  preferredAliasI18n: { 'zh-CN': 'stats week', en: 'stats week' },
  execute({ config, input, owner, use, has, locale }) {
    const groupId = resolveGroupId({ ...input, locale });
    const title = groupId ? t(locale, 'statsWeekGroup') : t(locale, 'statsWeekAll');
    return statsRankText(
      { ...input, locale },
      groupSuiteConfigFor({ config, has, use }, input),
      weekStartStr(),
      title,
      resolveGroupSuiteRuntime({ owner, use }),
    );
  },
});
