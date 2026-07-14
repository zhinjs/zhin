import { describe, expect, it, afterEach, vi } from 'vitest';
import Koa from 'koa';
import koaBody from 'koa-body';
import { createServer, type Server } from 'node:http';
import { Router } from '@zhin.js/host-router/router';
import {
  AgentStreamEventType,
  ZHIN_AGENT_SESSION_API_PREFIX,
  ZHIN_SESSION_ID_HEADER,
} from '@zhin.js/contract';
import type { ZhinAgent } from '@zhin.js/agent';
import { registerZhinAgentStreamRoutes } from '../src/rest/zhin-agent-stream-rest-api.js';
import { createTestSessionPort, mockAgent } from '../../../im/agent/tests/session/session-test-helpers.js';

async function listen(app: Koa): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function createTestApp(agent: ZhinAgent | null): Koa {
  const port = agent ? createTestSessionPort(agent) : null;
  const app = new Koa();
  app.use(koaBody());
  const server = createServer(app.callback());
  const router = new Router(server, '');
  registerZhinAgentStreamRoutes(router, ZHIN_AGENT_SESSION_API_PREFIX, port);
  app.use(router.routes());
  app.use(router.allowedMethods());
  return app;
}

describe('registerZhinAgentStreamRoutes', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('GET /zhin/v1/health returns ok', async () => {
    const { server: s, baseUrl } = await listen(createTestApp(mockAgent([])));
    server = s;
    const res = await fetch(`${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'zhin-agent-session' });
  });

  it('POST /zhin/v1/session requires message', async () => {
    const { server: s, baseUrl } = await listen(createTestApp(mockAgent([])));
    server = s;
    const res = await fetch(`${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /zhin/v1/session starts session and GET stream returns NDJSON', async () => {
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      { type: 'chunk', text: 'Hi', accumulated: 'Hi' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'Hi' }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    ]);
    const { server: s, baseUrl } = await listen(createTestApp(agent));
    server = s;

    const startRes = await fetch(`${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });
    expect(startRes.status).toBe(200);
    expect(startRes.headers.get(ZHIN_SESSION_ID_HEADER)).toBeTruthy();
    const started = await startRes.json() as { sessionId: string; continuationToken: string };
    expect(started.sessionId).toMatch(/^ses_/);
    expect(started.continuationToken).toMatch(/^zhin:/);

    await vi.waitFor(async () => {
      const streamRes = await fetch(
        `${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session/${started.sessionId}/stream`,
      );
      const text = await streamRes.text();
      expect(text).toContain(AgentStreamEventType.SESSION_STARTED);
      expect(text).toContain(AgentStreamEventType.SESSION_WAITING);
    }, { timeout: 5000 });
  });

  it('POST continue returns new continuationToken; stale token is 409', async () => {
    const agent = mockAgent([
      { type: 'turn_start', sessionId: 's', turnId: 't' },
      {
        type: 'turn_end',
        output: [{ type: 'text', content: 'ok' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    ]);
    const { server: s, baseUrl } = await listen(createTestApp(agent));
    server = s;

    const startRes = await fetch(`${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'first' }),
    });
    const { sessionId, continuationToken: initialToken } = await startRes.json() as {
      sessionId: string;
      continuationToken: string;
    };

    let freshToken = '';
    await vi.waitFor(async () => {
      const streamRes = await fetch(
        `${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session/${sessionId}/stream`,
      );
      const lines = (await streamRes.text()).trim().split('\n').filter(Boolean);
      const waiting = lines
        .map((line) => JSON.parse(line) as { type: string; data?: { continuationToken?: string } })
        .find((e) => e.type === AgentStreamEventType.SESSION_WAITING);
      freshToken = waiting?.data?.continuationToken ?? '';
      expect(freshToken).toMatch(/^zhin:/);
    }, { timeout: 5000 });

    const staleRes = await fetch(
      `${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session/${sessionId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ continuationToken: initialToken, message: 'nope' }),
      },
    );
    expect(staleRes.status).toBe(409);

    const continueRes = await fetch(
      `${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session/${sessionId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ continuationToken: freshToken, message: 'second' }),
      },
    );
    expect(continueRes.status).toBe(200);
    const continued = await continueRes.json() as { continuationToken: string };
    expect(continued.continuationToken).toMatch(/^zhin:/);
    expect(continued.continuationToken).not.toBe(freshToken);
  });

  it('returns 503 when HTTP agent session runtime is not ready', async () => {
    const { server: s, baseUrl } = await listen(createTestApp(null));
    server = s;
    const res = await fetch(`${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(res.status).toBe(503);
  });

  it('POST authorization complete returns 404 for unknown request', async () => {
    const { server: s, baseUrl } = await listen(createTestApp(mockAgent([])));
    server = s;
    const res = await fetch(
      `${baseUrl}${ZHIN_AGENT_SESSION_API_PREFIX}/authorization/unknown/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      },
    );
    expect(res.status).toBe(404);
  });
});
