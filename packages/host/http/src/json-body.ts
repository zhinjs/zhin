import type { IncomingMessage } from 'node:http';

export class HttpBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'HttpBodyError';
  }
}

/**
 * Read and parse a JSON request body with a size limit (default 1 MiB).
 * Empty bodies become `undefined`.
 */
export async function readJsonBody<T = unknown>(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<T | undefined> {
  const limit = options.limit ?? 1_048_576;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      request.destroy();
      throw new HttpBodyError(`Request body exceeds ${limit} bytes`, 413);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpBodyError('Invalid JSON body', 400);
  }
}
