import { defineCommand } from 'zhin.js/command';
import { raw } from '@zhin.js/core/runtime';
import { bilibiliEndpointRegistryToken, startLoginForChat } from '@zhin.js/adapter-bilibili';

export default defineCommand({
  description: '扫码登录 B 站（只在私聊里发二维码）', descriptionI18n: { en: 'Sign in to Bilibili with a QR code (private chats only)' },
  permit: ['role(master)'],
  async execute({ args, use, locale, input, formatCommand }) {
    const result = await startLoginForChat(use(bilibiliEndpointRegistryToken), {
      id: args[0]?.trim() || undefined,
      locale,
      isPrivate: input?.conversation.kind === 'private',
      statusCommand: formatCommand('bili-login status'),
    });
    if (result.kind === 'text') return result.text;
    return raw([
      { type: 'text', data: { text: `${result.text}\n` } },
      { type: 'image', data: { url: `base64://${result.image.slice(result.image.indexOf(',') + 1)}` } },
      ...(result.hint ? [{ type: 'text', data: { text: `\n${result.hint}` } }] : []),
    ]);
  },
});
