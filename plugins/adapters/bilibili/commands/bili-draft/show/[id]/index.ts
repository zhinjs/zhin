import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, showDraftText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '查看一条 B 站评论草稿全文', descriptionI18n: { en: 'Read a complete Bilibili comment draft' },
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  execute(context) {
    const { params, locale, formatCommand } = context;
    const directory = bilibiliEndpoints(context);
    return showDraftText(directory, String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
