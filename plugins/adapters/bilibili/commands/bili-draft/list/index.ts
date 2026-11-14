import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, listDraftsText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '查看待审的 B 站评论回复草稿', descriptionI18n: { en: 'List Bilibili comment drafts awaiting review' },
  alias: ['bili draft list'],
  preferredAliasI18n: { 'zh-CN': 'bili draft list', en: 'bili draft list' },
  permit: ['owner'],
  execute(context) {
    const { locale, formatCommand } = context;
    const directory = bilibiliEndpoints(context);
    return listDraftsText(directory, { locale, formatCommand });
  },
});
