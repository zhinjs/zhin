import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import { createHttpHost } from '@zhin.js/host-http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import defineGithubAdapter from '../adapters/github.js';
import { GithubEndpoint } from '../src/endpoint.js';
import { GhClient } from '../src/gh-client.js';
import {
  enrichInboundContent,
  formatOutboundBody,
  resolveGithubConfig,
  shouldAutoReplyRepo,
  verifyWebhookSignature,
} from '../src/protocol.js';
import { getGithubAgentDeps, setGithubAgentDeps } from '../src/github-agent-deps.js';

const adapterFeature = featureId('zhin.adapter');
const hosts: ReturnType<typeof createHttpHost>[] = [];
const WEBHOOK_SECRET = 'test-webhook-secret';

const baseConfig = resolveGithubConfig({
  name: 'test-github-bot',
  app_id: 1,
  private_key: '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----',
  webhook_secret: WEBHOOK_SECRET,
  webhook_path: '/github/webhook',
});

function signBody(body: string, secret = WEBHOOK_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function mockGhClient(overrides: Partial<GhClient> = {}): GhClient {
  return {
    verifyAuth: vi.fn(async () => ({ ok: true, user: 'bot[bot]', message: 'ok' })),
    authenticatedUser: 'bot[bot]',
    getBotLogin: () => 'bot[bot]',
    clientId: 'client-1',
    appSlug: 'bot',
    installations: [],
    createIssueComment: vi.fn(async () => ({ ok: true, status: 200, data: { id: 99 } })),
    createPRComment: vi.fn(async () => ({ ok: true, status: 200, data: { id: 100 } })),
    ...overrides,
  } as unknown as GhClient;
}

afterEach(async () => {
  setGithubAgentDeps(null);
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

describe('github protocol helpers', () => {
  it('resolves plugin config with defaults', () => {
    const resolved = resolveGithubConfig({
      app_id: 42,
      private_key: 'key',
    });
    expect(resolved.webhookPath).toBe('/github/webhook');
    expect(resolved.name).toBe('github-bot');
    expect(resolved.appId).toBe(42);
  });

  it('verifies HMAC-SHA256 webhook signatures', () => {
    const body = '{"ok":true}';
    const sig = signBody(body);
    expect(verifyWebhookSignature(WEBHOOK_SECRET, body, sig)).toBe(true);
    expect(verifyWebhookSignature(WEBHOOK_SECRET, body, 'sha256=bad')).toBe(false);
  });

  it('formats outbound string and segment payloads', () => {
    expect(formatOutboundBody('pong')).toBe('pong');
    expect(formatOutboundBody([
      { type: 'text', data: { text: 'hi' } },
      { type: 'at', data: { id: 'alice', name: 'alice' } },
    ])).toBe('hi@alice');
  });

  it('shouldAutoReplyRepo matches case-insensitive', () => {
    expect(shouldAutoReplyRepo({ autoReplyRepos: ['Owner/Repo'] }, 'owner/repo')).toBe(true);
    expect(shouldAutoReplyRepo({ autoReplyRepos: ['other/x'] }, 'owner/repo')).toBe(false);
  });

  it('enrichInboundContent prepends @bot for auto_reply repos', () => {
    expect(enrichInboundContent(
      'hello',
      { autoReplyRepos: ['owner/repo'], botLogin: 'bot[bot]' },
      'bot[bot]',
      'owner/repo',
    )).toBe('@bot[bot] hello');
  });
});

describe('github plugin runtime adapter', () => {
  it('POST webhook with valid signature admits via MessageGateway when open', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const gh = mockGhClient();
    const endpoint = new GithubEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'github'),
      gateway,
      http,
      config: baseConfig,
      createClient: () => gh,
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const payload = {
      action: 'created',
      comment: {
        id: 1,
        body: 'hello from issue',
        user: { login: 'alice', id: 1, html_url: '' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        html_url: '',
      },
      issue: { number: 42, title: 't', html_url: '', state: 'open', user: { login: 'alice', id: 1, html_url: '' } },
      repository: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo' },
      sender: { login: 'alice', id: 1, html_url: '' },
    };
    const body = JSON.stringify(payload);
    const res = await fetch(`http://127.0.0.1:${port}/github/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signBody(body),
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'd1',
      },
      body,
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'owner/repo/issues/42',
      content: 'hello from issue',
      sender: 'alice',
      id: '1',
    }));
    await endpoint.stop();
  });

  it('rejects webhook with invalid signature', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new GithubEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'github'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      http,
      config: baseConfig,
      createClient: () => mockGhClient(),
    });
    await endpoint.start();
    endpoint.open();
    const { port } = await http.listen();

    const res = await fetch(`http://127.0.0.1:${port}/github/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=invalid',
        'x-github-event': 'issue_comment',
      },
      body: JSON.stringify({ action: 'created' }),
    });
    expect(res.status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const endpoint = new GithubEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'github'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: resolveGithubConfig({ name: 'api-only', app_id: 1, private_key: 'k' }),
      createClient: () => mockGhClient(),
    });
    await endpoint.start();
    endpoint.admit({
      id: '1',
      channelId: 'o/r/issues/1',
      sender: 'alice',
      content: 'hi',
      repo: 'o/r',
      kind: 'issue_comment',
      createdAt: 1,
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('send posts issue comment via GhClient', async () => {
    const gh = mockGhClient();
    const endpoint = new GithubEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'github'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: resolveGithubConfig({ name: 'api-only', app_id: 1, private_key: 'k' }),
      createClient: () => gh,
    });
    await endpoint.start();
    endpoint.open();
    const id = await endpoint.send({
      target: 'owner/repo/issues/7',
      payload: 'reply text',
    });
    expect(id).toBe('99');
    expect(gh.createIssueComment).toHaveBeenCalledWith('owner/repo', 7, 'reply text');
    await endpoint.stop();
  });

  it('registers agent endpoint on start', async () => {
    const endpoint = new GithubEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'github'),
      gateway: { receive: vi.fn(), send: vi.fn(async () => 'sent') },
      config: resolveGithubConfig({ name: 'agent-bot', app_id: 1, private_key: 'k' }),
      createClient: () => mockGhClient(),
    });
    await endpoint.start();
    expect(getGithubAgentDeps().getEndpoint('agent-bot')).toBe(endpoint);
    await endpoint.stop();
  });

  it('defineAdapter exports frozen definition', () => {
    expect(defineGithubAdapter.$feature).toBe('zhin.adapter/1');
    expect(defineGithubAdapter.capabilities).toEqual(['inbound', 'outbound']);
  });
});
