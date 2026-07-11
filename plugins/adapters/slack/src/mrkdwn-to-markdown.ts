/**
 * Slack mrkdwn → 通用 Markdown（入站文本段）
 */
export function mrkdwnToMarkdown(text: string): string {
  let result = text;
  result = result.replace(/<([^|>]+)\|([^>]+)>/g, '[$2]($1)');
  result = result.replace(/<(https?:\/\/[^>]+)>/g, '[$1]($1)');
  result = result.replace(/\*([^*]+)\*/g, '**$1**');
  result = result.replace(/_([^_]+)_/g, '*$1*');
  result = result.replace(/~([^~]+)~/g, '~~$1~~');
  return result;
}
