import { EndpointDeliveryError } from '@zhin.js/im-contract';

/** Discord response evidence; request URLs, authorization headers and submitted bodies are excluded. */
export class DiscordRestRequestError extends EndpointDeliveryError {
  readonly status?: number;
  readonly body?: string;

  constructor({ status, body, cause }: Readonly<{ status?: number; body?: string; cause?: unknown }>) {
    const rejection = nativeRejection(status, body);
    const rejected = rejection !== undefined;
    super(rejected ? 'platform_rejected' : 'delivery_unconfirmed',
      status === undefined ? 'Discord REST request failed before a response was available'
        : `Discord REST request ${rejected ? 'rejected' : 'unconfirmed'} (${status})${rejected ? `: ${rejection}` : ''}`,
      rejected ? 'rejected' : 'unknown', { cause });
    this.name = 'DiscordRestRequestError';
    this.status = status;
    this.body = body;
  }

  /** HTTP success survives an unreadable response body; it does not prove any profile field. */
  get acknowledged(): boolean { return this.status !== undefined && this.status >= 200 && this.status < 300; }
}

/** Official rejection statuses plus a native JSON error, never a proxy timeout/body alone.
 * @see https://docs.discord.com/developers/topics/opcodes-and-status-codes#http
 * @see https://docs.discord.com/developers/topics/rate-limits#rate-limit-response-structure
 */
function nativeRejection(status: number | undefined, body: string | undefined): string | undefined {
  if (status === undefined || ![400, 401, 403, 404, 405, 429].includes(status) || !body) return undefined;
  try {
    const value = JSON.parse(body) as { code?: unknown; message?: unknown; retry_after?: unknown; global?: unknown } | null;
    if (typeof value?.message !== 'string') return undefined;
    if (typeof value.code === 'number' && Number.isSafeInteger(value.code)) return `code ${value.code}`;
    if (status === 429 && typeof value.retry_after === 'number' && Number.isFinite(value.retry_after)
      && value.retry_after >= 0 && typeof value.global === 'boolean') return 'rate limited';
    return undefined;
  } catch { return undefined; }
}
