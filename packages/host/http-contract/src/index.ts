import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The narrow route metadata that protocol hosts may contribute to the HTTP
 * OpenAPI catalog. Keep this data-only so the contract remains independent
 * from the concrete HTTP host implementation.
 */
export interface HttpRouteParameter {
  readonly name: string;
  readonly in: 'query' | 'path' | 'header';
  readonly required?: boolean;
  readonly description?: string;
  readonly schema?: Record<string, unknown>;
}

export interface HttpRouteMeta {
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly operationId?: string;
  readonly deprecated?: boolean;
  readonly parameters?: readonly HttpRouteParameter[];
  readonly responses?: Record<string, unknown>;
  readonly requestBody?: Record<string, unknown>;
}

/** A protocol route does not need to know how the Host represents auth. */
export type HttpRouteHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => void | Promise<void>;

export type HttpRouteRegistration = () => void;

/**
 * Minimal inbound HTTP capability consumed by protocol hosts such as MCP and
 * A2A. The concrete Host may expose richer APIs, but those stay out of the
 * protocol packages' public declarations.
 */
export interface HttpRouteHost {
  route(
    method: string,
    path: string,
    handler: HttpRouteHandler,
    meta?: HttpRouteMeta,
  ): HttpRouteRegistration;
}

/** A serializable request-body failure suitable for an HTTP response. */
export class HttpBodyError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'HttpBodyError';
  }
}

async function readBoundedBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const chunk of request) {
    if (exceeded) continue;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      exceeded = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buffer);
  }
  if (exceeded) throw new HttpBodyError(`Request body exceeds ${limit} bytes`, 413);
  return Buffer.concat(chunks);
}

/**
 * Read a request body as UTF-8 text with a size limit (default 1 MiB).
 * The text is returned verbatim (no trimming) so callers can verify webhook
 * signatures over it. Oversize requests are fully drained before reporting
 * 413, exactly like `readJsonBody()`.
 */
export async function readTextBody(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<string> {
  return (await readBoundedBody(request, options.limit ?? 1_048_576)).toString('utf8');
}

/**
 * Read and parse a JSON request body with a size limit (default 1 MiB).
 * Empty bodies become `undefined`. Oversize requests are fully drained before
 * reporting 413 so callers can still respond on the same socket.
 */
export async function readJsonBody<T = unknown>(
  request: IncomingMessage,
  options: { readonly limit?: number } = {},
): Promise<T | undefined> {
  const raw = (await readBoundedBody(request, options.limit ?? 1_048_576)).toString('utf8').trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpBodyError('Invalid JSON body', 400);
  }
}
