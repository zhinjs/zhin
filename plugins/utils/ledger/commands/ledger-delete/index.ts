import { resolveLocale } from 'zhin.js/i18n';
import { messages as t } from '../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { ledgerCaller, replyLedger } from '../../src/identity.js';
import { ledgerServiceToken } from '../../src/runtime.js';

export default defineCommand({
  description: '删除自己的一笔记账：删账 <编号>', descriptionI18n: { en: "Delete one of your expense records" },
  alias: ['删账'],
  params: {
    id: { type: 'integer', min: 1, description: '账目编号（记账回复或「账单」中的 #编号）', descriptionI18n: { en: "Record ID from the expense list" } },
  },
  async execute({ input, params, use, locale, formatCommand }) {
    return replyLedger(async () => {
      const caller = ledgerCaller(input, locale);
      return use(ledgerServiceToken).deleteEntry(caller, params.id);
    });
  },
});
