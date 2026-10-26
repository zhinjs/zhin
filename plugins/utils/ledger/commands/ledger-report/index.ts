import { resolveLocale } from 'zhin.js/i18n';
import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';
import type { DailyReportAction } from '../../src/service.js';

export default defineCommand({
  description: '订阅或取消每日私信记账日报：记账日报 [开启|关闭|状态]', descriptionI18n: { en: "Manage the daily expense report sent by private message" },
  alias: ['记账日报'],
  params: {
    action: { type: 'word', optional: true, description: '开启、关闭或状态（默认状态）', descriptionI18n: { en: "on, off, or status (default: status)" } },
  },
  async execute({ input, params, use, locale, formatCommand }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input, locale);
      const actions: Readonly<Record<string, DailyReportAction>> = resolveLocale(locale) === 'en' ? { on: 'on', off: 'off', status: 'status' } : { 开启: 'on', 关闭: 'off', 状态: 'status' };
      const action = params.action === undefined ? 'status' : actions[params.action];
      if (!action) return t(locale, 'actionInput');
      return use(ledgerServiceToken).dailyReport(caller, action, formatCommand('ledger-report'));
    });
  },
});
