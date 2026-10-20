import { EndpointDeliveryError } from '@zhin.js/im-contract';

/** Project SDK request failures into stable delivery evidence without exposing request data. */
export function qqDeliveryFailure(error: unknown) {
  const value = error && typeof error === 'object' ? error as { response?: { status?: unknown; data?: { code?: unknown } }; config?: { url?: unknown }; code?: unknown } : {};
  const httpStatus = typeof value.response?.status === 'number' ? value.response.status : undefined;
  let platformCode = typeof value.response?.data?.code === 'number' && Number.isFinite(value.response.data.code) ? value.response.data.code : undefined;
  let path = typeof value.config?.url === 'string' ? value.config.url.split('?')[0] : '';
  // Published SDK 1.3 flattens Axios rejection into this exact message format.
  // Extract only operation suffix and numeric protocol code; never surface the message.
  const flattened = error instanceof Error ? /^Request "([^"]+)" failed with code\((\d+)\):/.exec(error.message) : null;
  if (flattened) {
    path ||= flattened[1].split('?')[0];
    platformCode ??= Number(flattened[2]);
  }
  const stage = /\/upload_prepare$/.test(path) ? 'upload_prepare' : /\/upload_part_finish$/.test(path) ? 'upload_part_finish' : /\/files$/.test(path) ? 'upload_complete' : /\/messages$/.test(path) ? 'send_message' : 'sdk_send';
  const knownRejection = (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) || (!!flattened && platformCode !== undefined && ((platformCode >= 400 && platformCode < 500) || platformCode >= 1000));
  const failure = error instanceof EndpointDeliveryError ? error : new EndpointDeliveryError(knownRejection ? 'platform_rejected' : 'delivery_unconfirmed', knownRejection ? 'QQ platform rejected the outbound request' : 'QQ outbound request outcome is unknown', knownRejection ? 'rejected' : 'unknown', { cause: error });
  return { failure, diagnostic: { op: 'qq_delivery_failed', stage, httpStatus, platformCode, code: failure.code, disposition: failure.disposition } };
}
