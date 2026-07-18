import type { IncomingMessage } from 'node:http';

export function verifyOneBotAccessToken(
  accessToken: string | undefined,
  request: IncomingMessage,
): boolean {
  if (!accessToken) return true;
  const auth = request.headers.authorization ?? '';
  if (auth === `Bearer ${accessToken}`) return true;
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.searchParams.get('access_token') === accessToken) return true;
  } catch {
    /* ignore */
  }
  return false;
}
