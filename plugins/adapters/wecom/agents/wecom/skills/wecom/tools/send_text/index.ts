import { messages as t } from "../../../../messages.js";
import { defineAgentTool } from '@zhin.js/tool';
import { outboundMessageToken, untrustedContent } from '@zhin.js/core/runtime';
import { resolveChatType } from '@zhin.js/adapter-wecom';
import { z } from 'zod';

export default defineAgentTool<{ user_id: string; content: string }>({
  description: '用当前企业微信应用账号向指定用户发送文本消息（可发给任意用户，仅全局主人可用）',
  inputSchema: z.object({
    user_id: z.string().describe('用户 ID'),
    content: z.string().describe('消息内容'),
  }),
  adapter: 'wecom',
  tags: ['wecom'],
  // Messages any user of the organization, outside the current conversation: host-global (ADR 0056 §5).
  permissions: ['owner@global'],
  async execute({ user_id, content }, context) {
    const { origin } = context;
    const endpoint = origin?.kind === 'im' && origin.platform === 'wecom' ? origin.conversation?.endpoint : undefined;
    const id = user_id.trim();
    if (!endpoint || !id) return { success: false, message: t(context.locale, 'sendFailed') };
    context.signal?.throwIfAborted();
    // Through the IM outbound chain (renderer → outbound middleware → Endpoint), from the current account.
    const receipt = await context.use(outboundMessageToken).send({
      requester: context.owner.id,
      conversation: { endpoint, kind: resolveChatType(id), id },
      // Model-authored text: literal (no template paths), never media from the host.
      content: untrustedContent(content, { source: 'wecom:agent-tool', locale: context.locale }),
    });
    const success = receipt.status === 'sent';
    return { success, message: success ? t(context.locale, 'messageSent') : t(context.locale, 'sendFailed') };
  },
});
