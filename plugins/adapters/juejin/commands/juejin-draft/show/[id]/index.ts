import { defineCommand } from 'zhin.js/command';
import { juejinEndpoints, showDraftText } from '@zhin.js/adapter-juejin';

export default defineCommand({
  description: '查看一条掘金评论草稿全文', descriptionI18n: { en: 'Read a complete Juejin comment draft' },
  alias: ['juejin draft show'],
  preferredAliasI18n: { 'zh-CN': 'juejin draft show', en: 'juejin draft show' },
  permit: ['owner'],
  params: { id: { type: 'string', description: '列表中方括号内的草稿 ID', descriptionI18n: { en: 'Draft ID shown in square brackets in the list' } } },
  execute(context) {
    const { params, locale, formatCommand } = context;
    const directory = juejinEndpoints(context);
    return showDraftText(directory, String(params.id ?? '').trim(), { locale, formatCommand });
  },
});
