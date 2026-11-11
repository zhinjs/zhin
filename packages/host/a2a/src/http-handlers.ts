/**
 * HTTP handlers for A2A JSON-RPC, REST, and Agent Card (Web `Request` / `Response` — no Express).
 */
import { createHash } from 'node:crypto';
import {
  AgentCard,
  Message,
  Task,
  SendMessageRequest,
  StreamResponse,
  ListTasksResponse,
  A2A_CONTENT_TYPE,
  A2A_VERSION_HEADER,
  Extensions,
  HTTP_EXTENSION_HEADER,
} from '@a2a-js/sdk';
import {
  JsonRpcTransportHandler,
  InvalidAgentResponseError,
  RequestMalformedError,
  ServerCallContext,
  TaskNotFoundError,
  UnauthenticatedUser,
  UnsupportedOperationError,
  validateVersion,
  VersionNotSupportedError,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
import { HttpBodyError, readJsonBody } from '@zhin.js/host-http-contract';
import { RestTransportHandler } from './rest-transport-handler.js';

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

function formatSSEEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function formatSSEErrorEvent(data: unknown): string {
  return `event: error\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * An SSE response over an async iterator.
 *
 * The first item is pulled before the response exists, so a failure there still
 * propagates to the caller's JSON error path. Once the stream has started, a failure
 * becomes an SSE `error` event and the body is always ended. A client disconnect
 * (body cancellation) stops the iteration and lets the source run its cleanup.
 */
async function sseResponse<T>(
  iterator: AsyncIterator<T>,
  toJson: (value: T) => unknown,
  toError: (err: unknown) => unknown,
  headers: Headers,
): Promise<Response> {
  const encoder = new TextEncoder();
  let next: IteratorResult<T> | undefined = await iterator.next();
  let finished = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        const current = next ?? await iterator.next();
        next = undefined;
        if (current.done) {
          finished = true;
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(formatSSEEvent(toJson(current.value))));
      } catch (err) {
        finished = true;
        controller.enqueue(encoder.encode(formatSSEErrorEvent(toError(err))));
        controller.close();
      }
    },
    async cancel() {
      finished = true;
      await Promise.resolve(iterator.return?.()).catch(() => undefined);
    },
  }, { highWaterMark: 0 });
  for (const [key, value] of Object.entries(SSE_HEADERS)) headers.set(key, value);
  return new Response(body, { status: 200, headers });
}

async function readA2aJsonBody(req: Request): Promise<unknown> {
  return (await readJsonBody(req)) ?? {};
}

function buildServerContext(req: Request): ServerCallContext {
  return new ServerCallContext({
    requestedExtensions: Extensions.parseServiceParameter(
      req.headers.get(HTTP_EXTENSION_HEADER) ?? undefined,
    ),
    user: new UnauthenticatedUser(),
    requestedVersion: req.headers.get(A2A_VERSION_HEADER) ?? undefined,
  });
}

function sendJson(status: number, body: unknown, extraHeaders?: HeadersInit): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const [key, value] of new Headers(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function computeETag(json: string): string {
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

export async function handleAgentCard(
  req: Request,
  requestHandler: A2ARequestHandler,
): Promise<Response> {
  if (req.method !== 'GET') {
    return sendJson(405, { error: 'Method not allowed' });
  }
  try {
    const agentCard = await requestHandler.getAgentCard();
    const body = JSON.stringify(AgentCard.toJSON(agentCard));
    const etag = computeETag(body);
    const cacheHeaders = { ETag: etag, 'Cache-Control': 'public, max-age=3600' };
    if (req.headers.get('if-none-match') === etag) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }
    return sendJson(200, AgentCard.toJSON(agentCard), cacheHeaders);
  } catch {
    // Agent card failures are internal; no detail leaves the server.
    return sendJson(500, { error: 'Internal error' });
  }
}

export async function handleJsonRpc(
  req: Request,
  requestHandler: A2ARequestHandler,
  preParsedBody?: unknown,
): Promise<Response> {
  if (req.method !== 'POST') {
    return sendJson(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }
  const headers = new Headers();

  const transport = new JsonRpcTransportHandler(requestHandler);
  try {
    const body = preParsedBody !== undefined ? preParsedBody : await readA2aJsonBody(req);
    const context = buildServerContext(req);
    const agentCard = await requestHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'JSONRPC');

    const rpcResponseOrStream = await transport.handle(
      body as string | Record<string, unknown>,
      context,
    );

    if (context.activatedExtensions) {
      headers.set(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions).join(', '));
    }

    if (rpcResponseOrStream && typeof (rpcResponseOrStream as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      const stream = rpcResponseOrStream as AsyncGenerator<unknown, void, undefined>;
      const requestId = (body as { id?: unknown } | null)?.id ?? null;
      return await sseResponse(stream[Symbol.asyncIterator](), (value) => value, (err) => ({
        jsonrpc: '2.0',
        id: requestId,
        error: JsonRpcTransportHandler.mapToJSONRPCError(err),
      }), headers);
    }

    return sendJson(200, rpcResponseOrStream, headers);
  } catch (err) {
    if (err instanceof HttpBodyError) {
      return sendJson(err.statusCode, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }, headers);
    }
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: JsonRpcTransportHandler.mapToJSONRPCError(err),
    };
    return sendJson(200, errorResponse, headers);
  }
}

export async function handleRest(
  req: Request,
  requestHandler: A2ARequestHandler,
  subPath: string,
  preParsedBody?: unknown,
): Promise<Response> {
  const transport = new RestTransportHandler(requestHandler);
  const context = buildServerContext(req);
  const method = req.method;
  const url = new URL(req.url);
  // v1.0 uses unprefixed relative paths; retain the existing /v1 aliases.
  const path = subPath.replace(/^\//, '').replace(/^v1\//, '');

  try {
    const agentCard = await requestHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON');

    if (method === 'GET' && (path === '' || path === 'card')) {
      return sendJson(200, AgentCard.toJSON(await transport.getAgentCard()), { 'Content-Type': A2A_CONTENT_TYPE });
    }

    if (method === 'POST' && path === 'message:send') {
      const params = preParsedBody !== undefined ? preParsedBody : await readA2aJsonBody(req);
      const result = await transport.sendMessage(SendMessageRequest.fromJSON(params), context);
      return sendJson(200, 'messageId' in result
        ? { message: Message.toJSON(result) }
        : { task: Task.toJSON(result) }, { 'Content-Type': A2A_CONTENT_TYPE });
    }

    if (method === 'POST' && path === 'message:stream') {
      const params = preParsedBody !== undefined ? preParsedBody : await readA2aJsonBody(req);
      const stream = await transport.sendMessageStream(SendMessageRequest.fromJSON(params), context);
      return await sseResponse(
        stream[Symbol.asyncIterator](),
        (event) => StreamResponse.toJSON(event),
        (err) => ({ error: restErrorMessage(err) }),
        new Headers(),
      );
    }

    const taskGet = path.match(/^tasks\/([^/]+)$/);
    if (method === 'GET' && taskGet) {
      const taskId = taskGet[1];
      if (!taskId) {
        return sendJson(400, { error: 'invalid task id' });
      }
      const historyLength = url.searchParams.get('historyLength') ?? undefined;
      const result = await transport.getTask(taskId, context, historyLength ?? undefined);
      return sendJson(200, Task.toJSON(result), { 'Content-Type': A2A_CONTENT_TYPE });
    }

    const taskCancel = path.match(/^tasks\/([^/]+):cancel$/);
    if (method === 'POST' && taskCancel) {
      const taskId = taskCancel[1];
      if (!taskId) {
        return sendJson(400, { error: 'invalid task id' });
      }
      const result = await transport.cancelTask(taskId, context);
      return sendJson(200, Task.toJSON(result), { 'Content-Type': A2A_CONTENT_TYPE });
    }

    if (method === 'GET' && path === 'tasks') {
      const query: Record<string, string | undefined> = {};
      url.searchParams.forEach((v, k) => { query[k] = v; });
      const result = await transport.listTasks(query, context);
      return sendJson(200, ListTasksResponse.toJSON(result), { 'Content-Type': A2A_CONTENT_TYPE });
    }

    return sendJson(404, { error: 'Not found' });
  } catch (err) {
    return sendJson(restErrorStatus(err), { error: restErrorMessage(err) });
  }
}

/** Protocol and request errors carry client-facing messages; anything else stays opaque. */
function restErrorMessage(error: unknown): string {
  if (
    error instanceof HttpBodyError
    || error instanceof TaskNotFoundError
    || error instanceof RequestMalformedError
    || error instanceof UnsupportedOperationError
    || error instanceof VersionNotSupportedError
  ) {
    return error.message;
  }
  return 'Internal error';
}

/**
 * HTTP+JSON has HTTP status semantics. Keep its transport errors distinct from
 * request validation, missing tasks, and failures inside an agent executor.
 */
function restErrorStatus(error: unknown): number {
  if (error instanceof HttpBodyError) return error.statusCode;
  if (error instanceof TaskNotFoundError) return 404;
  if (
    error instanceof RequestMalformedError
    || error instanceof UnsupportedOperationError
    || error instanceof VersionNotSupportedError
  ) {
    return 400;
  }
  if (error instanceof InvalidAgentResponseError) return 500;
  return 500;
}
