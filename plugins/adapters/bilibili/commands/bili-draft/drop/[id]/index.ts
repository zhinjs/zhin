import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, discardDraftText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '丢弃一条 B 站评论草稿（不发送）', descriptionI18n: { en: 'Discard a Bilibili comment draft without sending' },
  alias: ['bili draft drop'],
  preferredAliasI18n: { 'zh-CN': 'bili draft drop', en: 'bili draft drop' },
  permit: ['owner'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  execute(context) {
    const { params, locale, formatCommand } = context;
    const directory = bilibiliEndpoints(context);
    return discardDraftText(directory, String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
