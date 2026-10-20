/**
 * Slack response_url 即时 ephemeral 反馈（斜杠命令 / 按钮交互）
 */
import type { Logger } from '@zhin.js/logger';

export function postSlackEphemeral(
  responseUrl: string,
  text: string,
  logger?: Logger,
): void {
  if (!responseUrl?.trim()) return;

  const body = JSON.stringify({
    response_type: 'ephemeral',
    text,
    replace_original: false,
  });

  fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch((err) => {
    logger?.debug(`Slack response_url failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
