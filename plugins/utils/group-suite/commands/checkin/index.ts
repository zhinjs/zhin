import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor, type GroupSuiteConfig } from '../../src/config.js';
import { doCheckin } from '../../src/checkin-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '每日签到获得积分', descriptionI18n: { en: "Check in daily to earn points" },
  alias: ['checkin do', '签到'],
  execute({ config, input, owner, use, has, locale }) {
    return doCheckin({ ...input, locale }, groupSuiteConfigFor({ config, has, use }, input), resolveGroupSuiteRuntime({ owner, use }));
  },
});
