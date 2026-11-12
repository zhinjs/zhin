import { verifyProtocolAccessToken, type ProtocolAuthRequest } from '@zhin.js/host-http';

export function verifyOneBotAccessToken(
  accessToken: string | undefined,
  request: ProtocolAuthRequest,
): boolean {
  // Webhook semantics: no configured token admits any caller (reverse sockets use verifyProtocolAccessToken).
  if (!accessToken) return true;
  return verifyProtocolAccessToken(accessToken, request);
}
