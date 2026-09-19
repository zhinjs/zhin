import { defineAgentTool } from '@zhin.js/tool';

export default defineAgentTool<{ message: string }>({
  description: '生成群聊公告或通知消息',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', description: '公告内容' } },
    required: ['message'],
  },
  approval: 'never',
  execute({ message }) {
    return `📢 群公告：\n${message}`;
  },
});
