import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { monthStartStr, resolveGroupId, statsRankText } from '../../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看本月话唠排行', descriptionI18n: { en: "View this month's most active members" },
  execute({ config, input, owner, use, locale }) {
    const groupId = resolveGroupId({ ...input, locale });
    const title = groupId ? t(locale, 'statsMonthGroup') : t(locale, 'statsMonthAll');
    return statsRankText(
      { ...input, locale },
      resolveGroupSuiteConfig(config),
      monthStartStr(),
      title,
      resolveGroupSuiteRuntime({ owner, use }),
    );
  },
});
