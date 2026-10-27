import { defineCommand } from 'zhin.js/command';
import { bilibiliEndpointRegistryToken, loginStatusText } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '查看 B 站登录状态', descriptionI18n: { en: 'Show the Bilibili login status' },
  permit: ['role(master)'],
  execute({ use, locale }) {
    return loginStatusText(use(bilibiliEndpointRegistryToken), locale);
  },
});
