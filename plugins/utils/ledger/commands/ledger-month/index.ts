import { resolveLocale } from 'zhin.js/i18n';
import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '查看本月消费合计与分类明细', descriptionI18n: { en: "View this month's spending totals and categories" },
  alias: ['本月消费'],
  async execute({ input, use, locale, formatCommand }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input, locale);
      return use(ledgerServiceToken).periodSummary(caller, 'month');
    });
  },
});
