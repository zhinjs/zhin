/** 将 activity-feedback / 工具入参规范为 Slack reactions.add 的 name（不含冒号） */
const UNICODE_TO_SLACK: Record<string, string> = {
  '⏳': 'hourglass_flowing_sand',
  '✅': 'white_check_mark',
  '❌': 'x',
  '⏰': 'alarm_clock',
  '🤔': 'thinking_face',
  '👀': 'eyes',
};

export function normalizeSlackReactionName(emoji: string): string {
  const trimmed = emoji.trim();
  if (!trimmed) return 'hourglass_flowing_sand';
  if (UNICODE_TO_SLACK[trimmed]) return UNICODE_TO_SLACK[trimmed]!;
  if (trimmed.startsWith(':') && trimmed.endsWith(':') && trimmed.length > 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/^:+|:+$/g, '');
}
