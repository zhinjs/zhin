import { resolveLocale } from 'zhin.js/i18n';
import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '记一笔消费：记 <类别> <金额> [备注]', descriptionI18n: { en: "Record an expense with a category, amount and optional note" },
  alias: ['记'],
  params: {
    entry: { type: 'text', min: 1, max: 200, description: '类别 金额 [备注]，例如：午饭 18.5 和同事', descriptionI18n: { en: "Category, amount and optional note, such as Lunch 18.5 With colleagues" } },
  },
  async execute({ input, params, use, locale, formatCommand }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input, locale);
      return use(ledgerServiceToken).addEntry(caller, params.entry);
    });
  },
});
