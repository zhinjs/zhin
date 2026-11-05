import { createMessages } from '@zhin.js/plugin-runtime';

export const ingressMessages = createMessages({
  cleared: { 'zh-CN': '已清空本会话的 AI 多轮上下文。', en: 'Cleared the AI conversation context for this session.' },
  stopped: { 'zh-CN': '好的，已停止当前回复。', en: 'OK, stopped the current reply.' },
  queue_full: { 'zh-CN': '前面还有几条消息在处理，请稍后再发。', en: 'Other messages are still being processed. Please try again shortly.' },
  expired: { 'zh-CN': '这条消息排队太久，已跳过，需要的话请重新发送。', en: 'This message waited too long and was skipped. Please send it again if needed.' },
});
