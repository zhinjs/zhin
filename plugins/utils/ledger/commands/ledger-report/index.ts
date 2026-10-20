import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';
import type { DailyReportAction } from '../../src/service.js';

const ACTIONS: Readonly<Record<string, DailyReportAction>> = {
  开启: 'on',
  关闭: 'off',
  状态: 'status',
};

export default defineCommand({
  description: '订阅或取消每日私信记账日报：记账日报 [开启|关闭|状态]',
  alias: ['记账日报'],
  params: {
    action: { type: 'word', optional: true, choices: ['开启', '关闭', '状态'], description: '开启、关闭或状态（默认状态）' },
  },
  async execute({ input, params, use }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input);
      const action = ACTIONS[params.action ?? '状态'] ?? 'status';
      return use(ledgerServiceToken).dailyReport(caller, action);
    });
  },
});
