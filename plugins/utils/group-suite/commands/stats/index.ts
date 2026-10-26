import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { todayStr } from '../../src/shared-runtime.js';
import { resolveGroupId, statsRankText } from '../../src/stats-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看今日消息统计', descriptionI18n: { en: "View today's message statistics" },
  execute({ config, input, owner, use, locale }) {
    const groupId = resolveGroupId({ ...input, locale });
    const title = groupId ? t(locale, 'statsTodayGroup') : t(locale, 'statsTodayAll');
    return statsRankText(
      { ...input, locale },
      resolveGroupSuiteConfig(config),
      todayStr(),
      title,
      resolveGroupSuiteRuntime({ owner, use }),
    );
  },
});
