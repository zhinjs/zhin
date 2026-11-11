import type { IncomingMessage } from 'node:http';
import { verifyProtocolAccessToken } from '@zhin.js/host-http';

export function verifyMilkyAccessToken(accessToken: string | undefined, request: IncomingMessage): boolean {
  // Webhook semantics: no configured token admits any caller (reverse sockets use verifyProtocolAccessToken).
  if (!accessToken) return true;
  return verifyProtocolAccessToken(accessToken, request);
}
