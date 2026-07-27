import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { handleSlackWebhookRequest, type SlackWebhookHandler } from '../src/webhook.js';
import { resolveSlackConfig } from '../src/protocol.js';

const SIGNING_SECRET = 'test-signing-secret';

const config = resolveSlackConfig({
  name: 'webhook-bot',
  token: 'xoxb-test-token',
  signingSecret: SIGNING_SECRET,
  socketMode: false,
  webhookPath: '/slack/events',
});

function signHeaders(rawBody: string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmac = createHmac('sha256', SIGNING_SECRET)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${hmac}`,
    'content-type': 'application/x-www-form-urlencoded',
  };
}

function mockRequest(rawBody: string): IncomingMessage {
  const request = Readable.from([rawBody]) as unknown as IncomingMessage;
  request.headers = signHeaders(rawBody);
  return request;
}

function mockResponse(): ServerResponse & { writeHeadCalls: number[] } {
  const calls: number[] = [];
  const response = {
    headersSent: false,
    writeHeadCalls: calls,
    writeHead(code: number) {
      // 模拟真实 ServerResponse：重复写头即抛错
      if (response.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
      response.headersSent = true;
      calls.push(code);
      return response;
    },
    end: vi.fn(),
  };
  return response as unknown as ServerResponse & { writeHeadCalls: number[] };
}

function mockHandler(): SlackWebhookHandler & {
  admitInteraction: ReturnType<typeof vi.fn>;
  admitSlashCommand: ReturnType<typeof vi.fn>;
  handleEnvelope: ReturnType<typeof vi.fn>;
} {
  return {
    config,
    handleEnvelope: vi.fn(),
    admitInteraction: vi.fn(),
    admitSlashCommand: vi.fn(),
  };
}

describe('slack webhook error paths', () => {
  it('writes the ack head only once when the interaction payload is invalid JSON', async () => {
    const rawBody = `payload=${encodeURIComponent('{not-json')}`;
    const handler = mockHandler();
    const response = mockResponse();

    await expect(
      handleSlackWebhookRequest(mockRequest(rawBody), response, handler),
    ).resolves.toBeUndefined();

    expect(response.writeHeadCalls).toEqual([200]);
    expect(handler.admitInteraction).not.toHaveBeenCalled();
  });

  it('acks and admits a valid interaction payload', async () => {
    const payload = {
      type: 'block_actions',
      user: { id: 'U1' },
      channel: { id: 'C1' },
      actions: [{ action_id: 'a1', action_ts: '1' }],
    };
    const rawBody = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const handler = mockHandler();
    const response = mockResponse();

    await handleSlackWebhookRequest(mockRequest(rawBody), response, handler);

    expect(response.writeHeadCalls).toEqual([200]);
    expect(handler.admitInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'block_actions' }),
    );
  });

  it('still rejects invalid signatures with 401', async () => {
    const rawBody = 'payload=%7B%7D';
    const request = mockRequest(rawBody);
    request.headers['x-slack-signature'] = 'v0=invalid';
    const handler = mockHandler();
    const response = mockResponse();

    await handleSlackWebhookRequest(request, response, handler);

    expect(response.writeHeadCalls).toEqual([401]);
    expect(handler.admitInteraction).not.toHaveBeenCalled();
  });
});
