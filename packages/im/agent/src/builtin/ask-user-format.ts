/** ask_user 的纯文本格式化（tool 与 session-service 共用，打破二者值导入循环）。 */
import type { Message } from '@zhin.js/core';

export function formatOwnerResponse(raw: string, questionType: string, args: Record<string, unknown>): string {
  switch (questionType) {
    case 'confirm':
      return raw.trim().toLowerCase() === 'yes' ? 'yes' : 'no';
    case 'number':
      return String(Number(raw) || 0);
    case 'pick': {
      const idx = Number(raw.trim());
      const options = (args.options as string[]) || [];
      if (idx >= 1 && idx <= options.length) return options[idx - 1]!;
      return raw;
    }
    case 'text':
    default:
      return raw;
  }
}

export function buildSensitiveOwnerQuestionText(
  commMessage: Message,
  question: string,
  questionType: string,
  options?: string[],
): string {
  const sourceInfo = commMessage.$channel?.type !== 'private'
    ? `来源: ${commMessage.$channel?.type}(${commMessage.$channel?.id}) 用户: ${commMessage.$sender.id}`
    : `来源: 私聊 用户: ${commMessage.$sender.id}`;
  let questionText = `请求确认：\n${sourceInfo}\n\n${question}`;
  if (questionType === 'confirm') {
    questionText += '\n输入"yes"以确认';
  } else if (questionType === 'pick' && options?.length) {
    questionText += '\n' + options.map((o, i) => `${i + 1}.${o}`).join('\n');
  } else if (questionType === 'number') {
    questionText += '\n(请输入数字)';
  }
  return questionText;
}
