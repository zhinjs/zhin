import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, discardDraftText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '丢弃一条 B 站评论草稿（不发送）', descriptionI18n: { en: 'Discard a Bilibili comment draft without sending' },
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  execute(context) {
    const { params, locale, formatCommand } = context;
    const directory = bilibiliEndpoints(context);
    return discardDraftText(directory, String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
