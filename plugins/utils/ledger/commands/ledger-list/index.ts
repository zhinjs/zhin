import { resolveLocale } from 'zhin.js/i18n';
import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { parsePeriodWord } from '../../src/period.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '列出账目及编号（最新 20 笔）：账单 [今日|本周|本月|全部]，默认本月', descriptionI18n: { en: "List the latest 20 expense records with IDs; defaults to the current month" },
  alias: ['账单'],
  params: {
    period: { type: 'word', optional: true, description: '今日、本周、本月或全部', descriptionI18n: { en: "Today, this week, this month, or all time" } },
  },
  async execute({ input, params, use, locale, formatCommand }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input, locale);
      const period = parsePeriodWord(params.period, 'month', locale);
      if (!period) return t(locale, 'periodInput');
      return use(ledgerServiceToken).listEntries(caller, period);
    });
  },
});
