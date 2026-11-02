import { EndpointDeliveryError } from '@zhin.js/im-contract';

/** Discord response evidence; request URLs, authorization headers and submitted bodies are excluded. */
export class DiscordRestRequestError extends EndpointDeliveryError {
  readonly status?: number;
  readonly body?: string;

  constructor({ status, body, cause }: Readonly<{ status?: number; body?: string; cause?: unknown }>) {
    const apiCode = nativeRejectionCode(status, body);
    const rejected = apiCode !== undefined;
    super(rejected ? 'platform_rejected' : 'delivery_unconfirmed',
      status === undefined ? 'Discord REST request failed before a response was available'
        : `Discord REST request ${rejected ? 'rejected' : 'unconfirmed'} (${status})${rejected ? `: code ${apiCode}` : ''}`,
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
 */
function nativeRejectionCode(status: number | undefined, body: string | undefined): number | undefined {
  if (status === undefined || ![400, 401, 403, 404, 405, 429].includes(status) || !body) return undefined;
  try {
    const value = JSON.parse(body) as { code?: unknown; message?: unknown } | null;
    return typeof value?.code === 'number' && Number.isSafeInteger(value.code) && typeof value.message === 'string'
      ? value.code : undefined;
  } catch { return undefined; }
}
