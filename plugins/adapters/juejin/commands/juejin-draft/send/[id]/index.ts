import { defineCommand } from 'zhin.js/command';
import { juejinEndpoints, approveDraftText } from '@zhin.js/adapter-juejin';

export default defineCommand({
  description: '审批并发出一条掘金评论草稿', descriptionI18n: { en: 'Approve and send a Juejin comment draft' },
  alias: ['juejin draft send'],
  preferredAliasI18n: { 'zh-CN': 'juejin draft send', en: 'juejin draft send' },
  permit: ['owner'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  async execute(context) {
    const { params, locale, formatCommand } = context;
    const directory = juejinEndpoints(context);
    return await approveDraftText(directory, String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
