import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import type { GroupSuiteConfig } from '../src/config.js';
import { myPoints } from '../src/checkin-lib.js';

export default defineCommand<GroupSuiteConfig, string, Message>({
  description: '查看个人积分与签到信息',
  execute({ input }) {
    return myPoints(input ?? {});
  },
});
