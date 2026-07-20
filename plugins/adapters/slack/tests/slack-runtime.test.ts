import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { SlackEndpoint, type SlackSocketLike, type SlackWebClientLike } from '../src/endpoint.js';
import {
  formatInboundContent,
  formatInteractionContent,
  formatOutboundWire,
  formatSlashContent,
  resolveSlackConfig,
  verifySlackSignature,
  type SlackMessageEvent,
} from '../src/protocol.js';
import { getSlackAgentDeps, setSlackAgentDeps } from '../src/slack-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const SIGNING_SECRET = 'test-signing-secret';

const socketConfig = resolveSlackConfig({
  name: 'test-slack-bot',
  token: 'xoxb-test-token',
  appToken: 'xapp-test-token',
  socketMode: true,
});

const httpConfig = resolveSlackConfig({
  name: 'test-slack-http',
  token: 'xoxb-test-token',
  signingSecret: SIGNING_SECRET,
  socketMode: false,
  webhookPath: '/slack/events',
});

function textEvent(overrides: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return {
    type: 'message',
    ts: '1700000000.000100',
    channel: 'C001',
    user: 'U001',
    text: 'hello',
    channel_type: 'channel',
    ...overrides,
  };
}

function mockClient(handlers: Partial<SlackWebClientLike> = {}): SlackWebClientLike {
  return {
    auth: {
      test: vi.fn(async () => ({ user_id: 'U_BOT', user: 'bot' })),
    },
    chat: {
      postMessage: vi.fn(async () => ({ ts: '1700000001.000000' })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    conversations: {
      invite: vi.fn(async () => ({})),
      kick: vi.fn(async () => ({})),
      setTopic: vi.fn(async () => ({})),
      setPurpose: vi.fn(async () => ({})),
      archive: vi.fn(async () => ({})),
      unarchive: vi.fn(async () => ({})),
      rename: vi.fn(async () => ({})),
      members: vi.fn(async () => ({ members: ['U1'] })),
      info: vi.fn(async () => ({ channel: { id: 'C001' } })),
    },
    users: {
      info: vi.fn(async () => ({ user: { id: 'U001' } })),
    },
    reactions: {
      add: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({})),
    },
    pins: {
      add: vi.fn(async () => ({})),
      remove: vi.fn(async () => ({})),
    },
    ...handlers,
  };
}

function mockSocket(): SlackSocketLike & {
  emit(event: string, body: unknown): Promise<void>;
} {
  const handlers = new Map<string, Array<(args: { ack: () => Promise<void>; body: unknown }) => void | Promise<void>>>();
  return {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    async start() {},
    async disconnect() {},
    async emit(event, body) {
      const list = handlers.get(event) ?? [];
      for (const handler of list) {
        await handler({ ack: async () => {}, body });
      }
    },
  };
}

function signBody(body: string, secret = SIGNING_SECRET): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmac = createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return { timestamp, signature: `v0=${hmac}` };
}

afterEach(async () => {
  setSlackAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('slack protocol helpers', () => {
  it('resolves socket mode by default', () => {
    const resolved = resolveSlackConfig({
      token: 'xoxb-a',
      appToken: 'xapp-a',
    });
    expect(resolved.mode).toBe('socket');
    expect(resolved.name).toBe('slack-bot');
    expect(resolved.webhookPath).toBe('/slack/events');
  });

  it('selects http mode when socketMode is false', () => {
    const resolved = resolveSlackConfig({
      token: 'xoxb-a',
      signingSecret: 'sec',
      socketMode: false,
    });
    expect(resolved.mode).toBe('http');
  });

  it('requires appToken for socket mode', () => {
    expect(() => resolveSlackConfig({ token: 'xoxb-a', socketMode: true })).toThrow(/appToken/);
  });

  it('requires signingSecret for http mode', () => {
    expect(() => resolveSlackConfig({ token: 'xoxb-a', socketMode: false })).toThrow(/signingSecret/);
  });

  it('formats inbound / interaction / slash content', () => {
    expect(formatInboundContent(textEvent())).toBe('hello');
    expect(formatInboundContent(textEvent({ text: '*bold*' }))).toBe('**bold**');
    expect(formatInteractionContent({
      type: 'block_actions',
      user: { id: 'U1' },
      actions: [{ type: 'button', action_id: 'vote_yes', block_id: 'b1', text: { type: 'plain_text', text: 'Yes' } }],
    })).toBe('[action: vote_yes Yes]');
    expect(formatSlashContent({
      token: 't',
      team_id: 'T',
      channel_id: 'C',
      channel_name: 'general',
      user_id: 'U',
      user_name: 'alice',
      command: '/ping',
      text: 'world',
      response_url: 'https://hooks.slack.com/x',
      trigger_id: 'trig',
    })).toBe('/ping world');
  });

  it('formats outbound wire text and mentions', () => {
    expect(formatOutboundWire('pong').text).toBe('pong');
    expect(formatOutboundWire([
      { type: 'at', data: { id: 'U123' } },
      { type: 'text', data: { text: ' hi' } },
    ]).text).toBe('<@U123> hi');
  });

  it('verifies Slack request signatures', () => {
    const body = '{"type":"event_callback"}';
    const { timestamp, signature } = signBody(body);
    expect(verifySlackSignature(SIGNING_SECRET, body, timestamp, signature)).toBe(true);
    expect(verifySlackSignature(SIGNING_SECRET, body, timestamp, 'v0=bad')).toBe(false);
  });
});

describe('slack plugin runtime adapter (socket)', () => {
  it('admits socket events via MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const socket = mockSocket();
    const client = mockClient();
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway,
      config: socketConfig,
      createClient: () => client,
      createSocket: () => socket,
    });
    await endpoint.start();
    endpoint.open();

    await socket.emit('slack_event', {
      type: 'event_callback',
      event: textEvent(),
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'C001',
      content: 'hello',
      sender: 'U001',
      id: 'C001:1700000000.000100',
    }));
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: socketConfig,
      createClient: () => mockClient(),
      createSocket: () => mockSocket(),
    });
    await endpoint.start();
    endpoint.admit(textEvent());
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends via chat.postMessage', async () => {
    const client = mockClient();
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: socketConfig,
      createClient: () => client,
      createSocket: () => mockSocket(),
    });
    await endpoint.start();
    endpoint.open();
    const id = await endpoint.send({ target: 'C001', payload: 'pong' });
    expect(id).toBe('C001:1700000001.000000');
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C001' }),
    );
    await endpoint.stop();
  });

  it('registers agent endpoint on start', async () => {
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: socketConfig,
      createClient: () => mockClient(),
      createSocket: () => mockSocket(),
    });
    await endpoint.start();
    const agent = getSlackAgentDeps().getEndpoint('test-slack-bot');
    expect(await agent.getChannelMembers('C001')).toEqual(['U1']);
    await endpoint.stop();
  });
});

describe('slack plugin runtime adapter (http)', () => {
  it('POST events with valid signature admits via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: httpConfig,
      createClient: () => mockClient(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const body = JSON.stringify({
      type: 'event_callback',
      event: textEvent(),
    });
    const { timestamp, signature } = signBody(body);
    const res = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'C001',
      content: 'hello',
    }));
    await endpoint.stop();
  });

  it('rejects invalid signature', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: httpConfig,
      createClient: () => mockClient(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const body = JSON.stringify({ type: 'event_callback', event: textEvent() });
    const res = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Slack-Signature': 'v0=invalid',
      },
      body,
    });
    expect(res.status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('answers url_verification challenge', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const endpoint = new SlackEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'slack'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      http,
      config: httpConfig,
      createClient: () => mockClient(),
    });
    await endpoint.start();
    const { port } = await http.listen();

    const body = JSON.stringify({ type: 'url_verification', challenge: 'ch-123', token: 't' });
    const { timestamp, signature } = signBody(body);
    const res = await fetch(`http://127.0.0.1:${port}/slack/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Slack-Request-Timestamp': timestamp,
        'X-Slack-Signature': signature,
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: 'ch-123' });
    await endpoint.stop();
  });
});
