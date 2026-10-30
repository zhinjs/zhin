import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpoints, loginStatusText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '查看 B 站登录状态', descriptionI18n: { en: 'Show the Bilibili login status' },
  permit: ['role(master)'],
  execute(context) {
    const { locale } = context;
    const directory = bilibiliEndpoints(context);
    return loginStatusText(directory, locale);
  },
});
