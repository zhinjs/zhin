import { defineCommand } from 'zhin.js/command';
import { juejinEndpoints, editDraftText, draftEditUsage } from '@zhin.js/adapter-juejin';

export default defineCommand({
  description: '改写一条掘金评论草稿，改完仍需审批发送', descriptionI18n: { en: 'Edit a Juejin comment draft; approval is still required to send' },
  alias: ['juejin draft edit'],
  preferredAliasI18n: { 'zh-CN': 'juejin draft edit', en: 'juejin draft edit' },
  permit: ['owner'],
  params: { id: { type: 'string', description: '草稿 ID', descriptionI18n: { en: 'Draft ID' } } },
  execute(context) {
    const { params, args, locale, formatCommand } = context;
    const directory = juejinEndpoints(context);
    const message = args.join(' ').trim();
    if (!message) return draftEditUsage({ locale, formatCommand });
    return editDraftText(directory, String(params.id ?? '').trim(), message, { locale, formatCommand });
  },
});
