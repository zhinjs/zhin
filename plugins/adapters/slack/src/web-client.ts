import { WebClient, ErrorCode, type WebClientOptions } from '@slack/web-api';
import { EndpointDeliveryError } from '@zhin.js/im-contract';

/** A non-idempotent outbound API call gets exactly one transport attempt. */
export function createSlackWebClient(token: string, options: WebClientOptions = {}): WebClient {
  return new WebClient(token, { ...options, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
}

export function slackDeliveryError(error: unknown): EndpointDeliveryError {
  if (error instanceof EndpointDeliveryError) return error;
  const value = error as { code?: unknown; statusCode?: unknown } | undefined;
  const status = typeof value?.statusCode === 'number' ? value.statusCode : undefined;
  const rejected = value?.code === ErrorCode.PlatformError || value?.code === ErrorCode.RateLimitedError
    || value?.code === ErrorCode.HTTPError && status !== undefined && status >= 400 && status < 500 && status !== 408;
  return new EndpointDeliveryError(rejected ? 'platform_rejected' : 'delivery_unconfirmed',
    rejected ? 'Slack rejected outbound request' : 'Slack outbound outcome is unknown', rejected ? 'rejected' : 'unknown');
}
