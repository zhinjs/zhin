/**
 * Slack 请求签名验证 — HMAC-SHA256
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SLACK_VERSION = 'v0';
const MAX_TIMESTAMP_DRIFT_SECONDS = 300;

export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return false;
  }

  const baseString = `${SLACK_VERSION}:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `${SLACK_VERSION}=${hmac}`;

  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
