import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { OneBotV12Response } from '@imhelper/onebot-v12';

/**
 * One classifier for native SDK, HTTP and WS results.
 * @see https://12.onebot.dev/connect/data-protocol/action-response/
 */
export function readOnebot12Response<T = unknown>(response: unknown): T | undefined {
  if (response && typeof response === 'object') {
    const result = response as Partial<OneBotV12Response>;
    if (result.status === 'ok' && result.retcode === 0) return result.data as T | undefined;
    if (result.status === 'failed' && typeof result.retcode === 'number' && Number.isSafeInteger(result.retcode) && result.retcode >= 10000 && result.retcode <= 99999) {
      throw new EndpointDeliveryError('platform_rejected',
        `OneBot 12 API rejected: retcode=${result.retcode}${result.message ? ` ${result.message}` : ''}`, 'rejected');
    }
  }
  // OB12 defines only ok/0 or failed with an error code; inconsistent envelopes prove neither result.
  throw new EndpointDeliveryError('delivery_unconfirmed', 'OneBot 12 response did not confirm the action result', 'unknown');
}
