import { defineCommand } from 'zhin.js/command';
import { juejinEndpoints, loginStatusText } from '@zhin.js/adapter-juejin';

export default defineCommand({
  description: '查看掘金登录状态', descriptionI18n: { en: 'Show the Juejin login status' },
  alias: ['juejin login status'],
  preferredAliasI18n: { 'zh-CN': 'juejin login status', en: 'juejin login status' },
  permit: ['owner'],
  execute(context) {
    const { locale } = context;
    const directory = juejinEndpoints(context);
    return loginStatusText(directory, locale);
  },
});
