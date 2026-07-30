import { generateCompactId } from './random.js';

/** 生成会话 ID */
export function generateSessionId(): string {
  return generateCompactId('s');
}

/** 比对出站 board_message_id 与平台回调 messageId（含 composite id） */
export function boardMessageMatches(stored: string, messageId: string): boolean {
  if (!stored || !messageId) return false;
  if (stored === messageId || stored.endsWith(`:${messageId}`)) return true;
  const tail = stored.split(':').pop();
  // 尾段匹配要求全等或以 `:tail` 结尾（段边界），避免 x99912345 误中 12345
  return !!tail && (messageId === tail || messageId.endsWith(`:${tail}`));
}
