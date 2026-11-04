import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, editDraftText, draftEditUsage } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '改写一条 B 站评论草稿，改完仍需审批发送', descriptionI18n: { en: 'Edit a Bilibili comment draft; approval is still required to send' },
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '草稿 ID', descriptionI18n: { en: 'Draft ID' } } },
  execute(context) {
    const { params, args, locale, formatCommand } = context;
    const directory = bilibiliEndpoints(context);
    const message = args.join(' ').trim();
    if (!message) return draftEditUsage({ locale, formatCommand });
    return editDraftText(directory, String(params.id ?? '').trim(), message, { locale, formatCommand });
  },
});
