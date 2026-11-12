import { messages as t } from "../../../../messages.js";
import { sendToCurrentChat } from "../../../../conversation.js";
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ question: string; options: string; is_anonymous?: boolean; allows_multiple?: boolean }>({
  description: '在当前 Telegram 会话中发起投票',
  inputSchema: z.object({
    question: z.string().describe('投票问题'),
    options: z.string().describe('选项 JSON 数组，如 ["A","B","C"]'),
    is_anonymous: z.boolean().optional().describe('是否匿名投票，默认 true'),
    allows_multiple: z.boolean().optional().describe('是否允许多选，默认 false'),
  }),
  adapter: 'telegram',
  tags: ['telegram'],
  async execute({ question, options, is_anonymous, allows_multiple }, context) {
    let optList: string[];
    try {
      optList = JSON.parse(options);
    } catch {
      return { success: false, message: t(context.locale, 'invalidPollOptions') };
    }
    if (!Array.isArray(optList) || optList.length < 2) {
      return { success: false, message: t(context.locale, 'pollOptionCount') };
    }
    // `telegram:poll` is the Telegram adapter's namespaced outbound segment.
    const result = await sendToCurrentChat(context, { type: 'telegram:poll', data: {
      question, options: optList, is_anonymous: is_anonymous ?? true, allows_multiple_answers: allows_multiple ?? false,
    } });
    return { ...result, message: t(context.locale, result.success ? 'pollSent' : 'operationFailed') };
  },
});
