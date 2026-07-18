import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../src/config.js';
import { doCheckin } from '../src/checkin-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '每日签到获得积分',
  execute({ config, input }) {
    return doCheckin(input ?? {}, resolveGroupSuiteConfig(config));
  },
});
