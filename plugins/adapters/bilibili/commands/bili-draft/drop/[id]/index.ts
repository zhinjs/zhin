import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken, discardDraftText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '丢弃一条 B 站评论草稿（不发送）', descriptionI18n: { en: 'Discard a Bilibili comment draft without sending' },
  permit: ['role(master)'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  execute({ params, use, locale, formatCommand }) {
    return discardDraftText(use(bilibiliEndpointRegistryToken), String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
