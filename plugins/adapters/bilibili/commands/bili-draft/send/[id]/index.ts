import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, approveDraftText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '审批并发出一条 B 站评论草稿', descriptionI18n: { en: 'Approve and send a Bilibili comment draft' },
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  async execute(context) {
    const { params, locale, formatCommand } = context;
    const directory = bilibiliEndpoints(context);
    return await approveDraftText(directory, String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
