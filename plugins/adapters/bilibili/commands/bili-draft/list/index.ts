import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken, listDraftsText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '查看待审的 B 站评论回复草稿', descriptionI18n: { en: 'List Bilibili comment drafts awaiting review' },
  permit: ['role(master)'],
  execute({ use, locale, formatCommand }) {
    return listDraftsText(use(bilibiliEndpointRegistryToken), { locale, formatCommand });
  },
});
