import { createHmac } from 'node:crypto';
import { webhookRequest } from '../../test-utils/http.js';
import { describe, expect, it, vi } from 'vitest';
import { handleSlackWebhookRequest, type SlackWebhookHandler } from '../src/webhook.js';
import { resolveSlackConfig } from '../src/protocol.js';

const SIGNING_SECRET = 'test-signing-secret';

const config = resolveSlackConfig({
  id: 'webhook-bot',
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

function mockRequest(rawBody: string, headers: Record<string, string> = {}): Request {
  return webhookRequest(rawBody, { ...signHeaders(rawBody), ...headers });
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
  it('acks once when the interaction payload is invalid JSON', async () => {
    const rawBody = `payload=${encodeURIComponent('{not-json')}`;
    const handler = mockHandler();

    const response = await handleSlackWebhookRequest(mockRequest(rawBody), handler);

    expect(response.status).toBe(200);
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

    const response = await handleSlackWebhookRequest(mockRequest(rawBody), handler);

    expect(response.status).toBe(200);
    expect(handler.admitInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'block_actions' }),
    );
  });

  it('still rejects invalid signatures with 401', async () => {
    const rawBody = 'payload=%7B%7D';
    const request = mockRequest(rawBody, { 'x-slack-signature': 'v0=invalid' });
    const handler = mockHandler();

    const response = await handleSlackWebhookRequest(request, handler);

    expect(response.status).toBe(401);
    expect(handler.admitInteraction).not.toHaveBeenCalled();
  });
});
