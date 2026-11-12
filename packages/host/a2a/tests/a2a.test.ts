import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http/node';
import { ALL, only, type BudgetAmounts, type Mail } from '@zhin.js/harness';
import {
  A2AMailboxTransport,
  installRuntimeA2aMailbox,
  signMailboxEnvelope,
  verifyMailboxEnvelope,
} from '../src/index.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
});

function sampleMail(overrides: Partial<Mail> = {}): Mail {
  return {
    id: 'mail-1',
    kind: 'delegate',
    engagementId: 'eng-1',
    causationId: 'mail-root',
    from: { kind: 'actor', actor: 'zhin' },
    to: 'coder',
    authority: {
      principal: { kind: 'human', id: 'alice', trust: 'trusted' },
      trust: 'group_member',
      tools: only(['read_file', 'grep']),
      contacts: ALL,
      egress: { network: false, hosts: only([]) },
      approvers: ['alice'],
      chain: ['zhin'],
    },
    grantId: 'grant-1',
    body: {
      kind: 'delegate',
      brief: 'Audit the config schema',
      deliverable: 'Markdown summary',
    },
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const sampleBudget: BudgetAmounts = {
  modelCalls: 5,
  tokens: 10_000,
  wallMs: 30_000,
  sideEffects: 0,
};

describe('A2AMailboxTransport & signed envelope verification (ADR 0048 §3.6)', () => {
  it('signs and verifies a canonical Mail + Authority + Budget envelope and rejects replays or tampering', () => {
    const mail = sampleMail();
    const now = 1_700_000_000_000;
    const unsigned = {
      mail,
      grantedBudget: sampleBudget,
      timestamp: now,
      nonce: 'nonce-1',
    };
    const signature = signMailboxEnvelope(unsigned, 'shared-secret');
    const seenNonces = new Set<string>();

    const verified = verifyMailboxEnvelope(
      { ...unsigned, signature },
      'shared-secret',
      { now, seenNonces },
    );
    expect(verified).toEqual({
      ok: true,
      mail,
      grantedBudget: sampleBudget,
    });

    // Replay with the same nonce is rejected.
    const replay = verifyMailboxEnvelope(
      { ...unsigned, signature },
      'shared-secret',
      { now, seenNonces },
    );
    expect(replay).toEqual({
      ok: false,
      status: 401,
      error: 'Replayed A2A Mailbox nonce rejected',
    });

    // Tampered authority trust or budget is rejected by HMAC verification.
    const tamperedBudget = verifyMailboxEnvelope(
      {
        ...unsigned,
        nonce: 'nonce-2',
        grantedBudget: { ...sampleBudget, sideEffects: 10 },
        signature,
      },
      'shared-secret',
      { now },
    );
    expect(tamperedBudget).toEqual({
      ok: false,
      status: 401,
      error: 'A2A Mailbox signature verification failed',
    });

    // Escalated authority trust above principal trust is rejected (403).
    const escalatedMail = sampleMail({
      authority: {
        ...mail.authority,
        principal: { kind: 'human', id: 'alice', trust: 'group_member' },
        trust: 'master',
      },
    });
    const escalatedUnsigned = {
      mail: escalatedMail,
      grantedBudget: sampleBudget,
      timestamp: now,
      nonce: 'nonce-3',
    };
    const escalatedSig = signMailboxEnvelope(escalatedUnsigned, 'shared-secret');
    expect(
      verifyMailboxEnvelope({ ...escalatedUnsigned, signature: escalatedSig }, 'shared-secret', { now }),
    ).toEqual({
      ok: false,
      status: 403,
      error: 'Invalid or unattenuated Mail authority in A2A Mailbox envelope',
    });
  });

  it('routes Mail across HTTP between two A2A Mailbox hosts and caps consumed budget', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const received: Array<{ mail: Mail; budget: BudgetAmounts }> = [];

    installRuntimeA2aMailbox({
      http,
      config: {
        enabled: true,
        path: '/a2a/mailbox',
        secret: 'cluster-secret',
      },
      fallbackToken: 'cluster-token',
      onReceive: async (mail, grantedBudget) => {
        received.push({ mail, budget: grantedBudget });
        return {
          status: 'completed',
          content: `Handled ${mail.id} for ${mail.authority.principal.id}`,
          // Attempt to report more tokens than granted; transport must cap it.
          consumed: { modelCalls: 2, tokens: 999_999, sideEffects: 5 },
        };
      },
    });

    const { port } = await http.listen();
    const sender = new A2AMailboxTransport({
      secret: 'cluster-secret',
      token: 'cluster-token',
      peers: [
        {
          actor: 'coder',
          url: `http://127.0.0.1:${port}/a2a/mailbox`,
        },
      ],
    });

    expect(sender.canRoute('coder')).toBe(true);
    expect(sender.canRoute('coder#ephemeral-1')).toBe(true);
    expect(sender.canRoute('unknown')).toBe(false);

    const mail = sampleMail({ to: 'coder#ephemeral-1' });
    const result = await sender.send(mail, sampleBudget);
    expect(result).toEqual({
      status: 'completed',
      content: 'Handled mail-1 for alice',
      consumed: {
        modelCalls: 2,
        tokens: sampleBudget.tokens,
        sideEffects: 0,
      },
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.mail.authority.tools).toEqual(only(['read_file', 'grep']));
    expect(received[0]!.budget).toEqual(sampleBudget);
  });

  it('executes inbound Mail through AgentHostPort when no custom onReceive is provided', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const execute = vi.fn(async () => ({
      status: 'completed' as const,
      output: [{ type: 'text' as const, content: 'audit complete' }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }));

    installRuntimeA2aMailbox({
      http,
      config: { enabled: true, secret: 'mesh-secret' },
      fallbackToken: 'mesh-token',
      agentHost: {
        protocol: {
          listBindings: () => [],
          execute,
        },
        introspection: { listMcpServers: () => [] },
        console: {} as never,
      },
    });

    const { port } = await http.listen();
    const sender = new A2AMailboxTransport({
      secret: 'mesh-secret',
      token: 'mesh-token',
      peers: [{ actor: 'coder', url: `http://127.0.0.1:${port}/a2a/mailbox` }],
    });

    const result = await sender.send(sampleMail(), sampleBudget);
    expect(result).toEqual({
      status: 'completed',
      content: 'audit complete',
      consumed: { modelCalls: 1, tokens: 150 },
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

describe('A2AMailboxTransport credential fallbacks', () => {
  function capture() {
    const calls: Array<{ headers: Record<string, string>; envelope: Record<string, unknown> }> = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      calls.push({
        headers: init?.headers as Record<string, string>,
        envelope: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ status: 'completed', content: 'ok' }), { status: 200 });
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  it('signs and authenticates with the token of a peer that only declares a token', async () => {
    const { calls, fetchImpl } = capture();
    const sender = new A2AMailboxTransport({
      fetchImpl,
      peers: [{ actor: 'coder', url: 'http://peer.test/a2a/mailbox', token: 'peer-token' }],
    });

    const result = await sender.send(sampleMail(), sampleBudget);

    expect(result.status).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.authorization).toBe('Bearer peer-token');
    const { signature, ...unsigned } = calls[0]!.envelope;
    expect(signature).toBe(signMailboxEnvelope(unsigned as never, 'peer-token'));
  });

  it('falls back to the secret as Bearer for a peer that only declares a secret', async () => {
    const { calls, fetchImpl } = capture();
    const sender = new A2AMailboxTransport({
      fetchImpl,
      peers: [{ actor: 'coder', url: 'http://peer.test/a2a/mailbox', secret: 'peer-secret' }],
    });

    await sender.send(sampleMail(), sampleBudget);

    expect(calls[0]!.headers.authorization).toBe('Bearer peer-secret');
    const { signature, ...unsigned } = calls[0]!.envelope;
    expect(signature).toBe(signMailboxEnvelope(unsigned as never, 'peer-secret'));
  });

  it('prefers the peer token over the transport token and treats empty strings as unset', async () => {
    const { calls, fetchImpl } = capture();
    const sender = new A2AMailboxTransport({
      fetchImpl,
      secret: '',
      token: 'cluster-token',
      peers: [
        { actor: 'coder', url: 'http://peer.test/a', token: 'peer-token', secret: '' },
        { actor: 'writer', url: 'http://peer.test/b' },
      ],
    });

    await sender.send(sampleMail(), sampleBudget);
    await sender.send(sampleMail({ to: 'writer' }), sampleBudget);

    expect(calls[0]!.headers.authorization).toBe('Bearer peer-token');
    expect(calls[1]!.headers.authorization).toBe('Bearer cluster-token');
    const { signature, ...unsigned } = calls[0]!.envelope;
    // secret '' falls through to the transport secret, which itself fell back to the token.
    expect(signature).toBe(signMailboxEnvelope(unsigned as never, 'cluster-token'));
  });
});

describe('installRuntimeA2aMailbox hardening', () => {
  it('requires a secret in production unless the mailbox is explicitly disabled', () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const message = 'A2A Mailbox requires a2a.mailbox.secret';

    // `enabled` omitted mounts the route, so it must be checked too.
    expect(() => installRuntimeA2aMailbox({ http, config: { path: '/mb' }, production: true }))
      .toThrow(message);
    expect(() => installRuntimeA2aMailbox({ http, config: { enabled: true, secret: '' }, production: true }))
      .toThrow(message);
    expect(() => installRuntimeA2aMailbox({ http, config: { enabled: false }, production: true }))
      .not.toThrow();
    const installed = installRuntimeA2aMailbox({
      http, config: { path: '/mb' }, fallbackToken: 'http-token', production: true,
    });
    installed.dispose();
  });

  it('answers 413 for an oversized envelope and 400 for an empty or malformed one', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    installRuntimeA2aMailbox({
      http,
      config: { secret: 'mesh-secret', maxBodyBytes: 1_024 },
      onReceive: async () => ({ status: 'completed', content: 'ok' }),
    });
    const { port } = await http.listen();
    const url = `http://127.0.0.1:${port}/a2a/mailbox`;
    const headers = { authorization: 'Bearer mesh-secret', 'content-type': 'application/json' };

    const tooLarge = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(200_000) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: 'Request body exceeds 1024 bytes' });

    const malformed = await fetch(url, { method: 'POST', headers, body: '{nope' });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON body' });

    const empty = await fetch(url, { method: 'POST', headers });
    expect(empty.status).toBe(400);
  });
});
