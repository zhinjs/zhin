/**
 * HTTP handlers for A2A JSON-RPC, REST, and Agent Card (Node http — no Express).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import {
  A2A_CONTENT_TYPE,
  A2A_VERSION_HEADER,
  Extensions,
  HTTP_EXTENSION_HEADER,
} from '@a2a-js/sdk';
import {
  JsonRpcTransportHandler,
  ServerCallContext,
  UnauthenticatedUser,
  validateVersion,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
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

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw) as unknown;
}

function buildServerContext(req: IncomingMessage): ServerCallContext {
  return new ServerCallContext({
    requestedExtensions: Extensions.parseServiceParameter(
      req.headers[HTTP_EXTENSION_HEADER.toLowerCase()] as string | undefined,
    ),
    user: new UnauthenticatedUser(),
    requestedVersion: req.headers[A2A_VERSION_HEADER.toLowerCase()] as string | undefined,
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(body));
}

function computeETag(json: string): string {
  const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
  return `W/"${hash}"`;
}

export async function handleAgentCard(
  req: IncomingMessage,
  res: ServerResponse,
  requestHandler: A2ARequestHandler,
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  try {
    const agentCard = await requestHandler.getAgentCard();
    const body = JSON.stringify(agentCard);
    const etag = computeETag(body);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      res.end();
      return;
    }
    sendJson(res, 200, agentCard);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleJsonRpc(
  req: IncomingMessage,
  res: ServerResponse,
  requestHandler: A2ARequestHandler,
  preParsedBody?: unknown,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed', Allow: 'POST' });
    return;
  }

  const transport = new JsonRpcTransportHandler(requestHandler);
  try {
    const body = preParsedBody !== undefined ? preParsedBody : await readJsonBody(req);
    const context = buildServerContext(req);
    const agentCard = await requestHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'JSONRPC');

    const rpcResponseOrStream = await transport.handle(
      body as string | Record<string, unknown>,
      context,
    );

    if (context.activatedExtensions) {
      res.setHeader(HTTP_EXTENSION_HEADER, Array.from(context.activatedExtensions).join(', '));
    }

    if (rpcResponseOrStream && typeof (rpcResponseOrStream as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
      const stream = rpcResponseOrStream as AsyncGenerator<unknown, void, undefined>;
      const iterator = stream[Symbol.asyncIterator]();
      const firstResult = await iterator.next();

      for (const [key, value] of Object.entries(SSE_HEADERS)) {
        res.setHeader(key, value);
      }
      if (!firstResult.done) {
        res.write(formatSSEEvent(firstResult.value));
      }
      for (;;) {
        const next = await iterator.next();
        if (next.done) break;
        res.write(formatSSEEvent(next.value));
      }
      if (!res.writableEnded) res.end();
      return;
    }

    sendJson(res, 200, rpcResponseOrStream);
  } catch (err) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: null,
      error: JsonRpcTransportHandler.mapToJSONRPCError(err),
    };
    sendJson(res, 200, errorResponse);
  }
}

export async function handleRest(
  req: IncomingMessage,
  res: ServerResponse,
  requestHandler: A2ARequestHandler,
  subPath: string,
  preParsedBody?: unknown,
): Promise<void> {
  const transport = new RestTransportHandler(requestHandler);
  const context = buildServerContext(req);
  const method = req.method ?? 'GET';
  const path = subPath.replace(/^\//, '');

  try {
    const agentCard = await requestHandler.getAgentCard();
    validateVersion(context.requestedVersion, agentCard, 'HTTP+JSON');

    if (method === 'GET' && (path === '' || path === 'v1/card')) {
      sendJson(res, 200, await transport.getAgentCard(), { 'Content-Type': A2A_CONTENT_TYPE });
      return;
    }

    if (method === 'POST' && path === 'v1/message:send') {
      const params = preParsedBody !== undefined ? preParsedBody : await readJsonBody(req);
      const result = await transport.sendMessage(params as never, context);
      sendJson(res, 200, result, { 'Content-Type': A2A_CONTENT_TYPE });
      return;
    }

    if (method === 'POST' && path === 'v1/message:stream') {
      const params = preParsedBody !== undefined ? preParsedBody : await readJsonBody(req);
      const stream = await transport.sendMessageStream(params as never, context);
      for (const [key, value] of Object.entries(SSE_HEADERS)) {
        res.setHeader(key, value);
      }
      for await (const event of stream) {
        res.write(formatSSEEvent(event));
      }
      if (!res.writableEnded) res.end();
      return;
    }

    const taskGet = path.match(/^v1\/tasks\/([^/]+)$/);
    if (method === 'GET' && taskGet) {
      const taskId = taskGet[1];
      if (!taskId) {
        sendJson(res, 400, { error: 'invalid task id' });
        return;
      }
      const historyLength = req.url?.includes('historyLength=')
        ? new URL(req.url, 'http://localhost').searchParams.get('historyLength') ?? undefined
        : undefined;
      const result = await transport.getTask(taskId, context, historyLength ?? undefined);
      sendJson(res, 200, result, { 'Content-Type': A2A_CONTENT_TYPE });
      return;
    }

    const taskCancel = path.match(/^v1\/tasks\/([^/]+):cancel$/);
    if (method === 'POST' && taskCancel) {
      const taskId = taskCancel[1];
      if (!taskId) {
        sendJson(res, 400, { error: 'invalid task id' });
        return;
      }
      const result = await transport.cancelTask(taskId, context);
      sendJson(res, 200, result, { 'Content-Type': A2A_CONTENT_TYPE });
      return;
    }

    if (method === 'GET' && path === 'v1/tasks') {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const query: Record<string, string | undefined> = {};
      url.searchParams.forEach((v, k) => { query[k] = v; });
      const result = await transport.listTasks(query, context);
      sendJson(res, 200, result, { 'Content-Type': A2A_CONTENT_TYPE });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function handleRestStreamError(
  res: ServerResponse,
  err: unknown,
  requestId: unknown,
): Promise<void> {
  if (!res.headersSent) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return;
  }
  res.write(formatSSEErrorEvent({
    jsonrpc: '2.0',
    id: requestId ?? null,
    error: JsonRpcTransportHandler.mapToJSONRPCError(err),
  }));
  if (!res.writableEnded) res.end();
}
