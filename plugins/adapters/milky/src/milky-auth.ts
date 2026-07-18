import type { IncomingMessage } from 'node:http';

export function verifyMilkyAccessToken(accessToken: string | undefined, request: IncomingMessage): boolean {
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

export async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_048_576) {
      request.destroy();
      throw new Error('Request body exceeds 1MB');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
