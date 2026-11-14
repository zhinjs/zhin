import { defineCommand } from 'zhin.js/command';
import { juejinEndpoints, listDraftsText } from '@zhin.js/adapter-juejin';

export default defineCommand({
  description: '查看待审的掘金评论回复草稿', descriptionI18n: { en: 'List Juejin comment drafts awaiting review' },
  alias: ['juejin draft list'],
  preferredAliasI18n: { 'zh-CN': 'juejin draft list', en: 'juejin draft list' },
  permit: ['owner'],
  execute(context) {
    const { locale, formatCommand } = context;
    const directory = juejinEndpoints(context);
    return listDraftsText(directory, { locale, formatCommand });
  },
});
