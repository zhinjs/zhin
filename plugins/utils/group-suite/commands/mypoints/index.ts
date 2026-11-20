import { defineCommand } from 'zhin.js/command';
import type { Message, SendContent } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../../src/config.js';
import { myPoints } from '../../src/checkin-lib.js';
import { resolveGroupSuiteRuntime } from '../../src/runtime-state.js';

export default defineCommand<GroupSuiteConfig, SendContent, Message>({
  description: '查看个人积分与签到信息', descriptionI18n: { en: "View your points and daily check-in" },
  alias: ['checkin streak', '积分', '我的积分'],
  execute({ input, owner, use, locale, formatCommand }) {
    return myPoints({ ...input, locale }, resolveGroupSuiteRuntime({ owner, use }), formatCommand?.('checkin'));
  },
});
