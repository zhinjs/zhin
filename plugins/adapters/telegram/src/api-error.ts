import { EndpointDeliveryError } from '@zhin.js/im-contract';

/** Machine-readable failures. Sending is never automatically retried. */
export type TelegramApiErrorKind =
  | 'timeout' | 'cancelled' | 'network' | 'http' | 'authentication'
  | 'rate_limit' | 'api' | 'invalid_response';

export class TelegramApiError extends EndpointDeliveryError {
  readonly kind: TelegramApiErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(
    kind: TelegramApiErrorKind,
    message: string,
    details: {
      readonly status?: number;
      readonly retryAfterSeconds?: number;
      readonly disposition?: EndpointDeliveryError['disposition'];
    } = {},
  ) {
    const disposition = details.disposition ?? (
      kind === 'authentication' || kind === 'rate_limit' || kind === 'api' ? 'rejected' : 'unknown'
    );
    super(disposition === 'rejected' ? 'platform_rejected'
      : kind === 'timeout' ? 'endpoint_timeout'
        : kind === 'cancelled' ? 'endpoint_cancelled' : 'delivery_unconfirmed', message, disposition);
    this.name = 'TelegramApiError';
    this.kind = kind;
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}
