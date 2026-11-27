/** #1250 b111: a failed WeCom identity lookup says why, without credentials. */
import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { WecomClient, redactValues } from '../src/client.js';
import { resolveWecomConfig } from '../src/protocol.js';

const config = resolveWecomConfig({
  id: 'reason-bot', corpId: 'corp', agentId: '1000002', agentSecret: 'agent-secret-value',
  token: 'callback-token-value', encodingAESKey: Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''),
  apiBaseUrl: 'https://qyapi.example.test',
});
const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'wecom');
const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => '', json: async () => data });

describe('WeCom identity verification failure reason', () => {
  it('carries errcode and errmsg and masks the secret and the access token', async () => {
    const fetch = vi.fn(async (url: string) => url.includes('/gettoken')
      ? ok({ errcode: 0, access_token: 'access-token-value', expires_in: 7200 })
      : ok({ errcode: 60020, errmsg: 'not allow to access from your ip, access_token access-token-value, secret agent-secret-value' }));
    const client = new WecomClient({ id, config, fetch });
    const error = await client.getApplicationInfo().catch((cause: unknown) => cause as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('WeCom application identity verification failed: not allow to access from your ip');
    expect(error.message).toContain('(errcode 60020)');
    expect(error.message).not.toContain('access-token-value');
    expect(error.message).not.toContain('agent-secret-value');
  });

  it('masks the secret in a refused token request', async () => {
    const fetch = vi.fn(async () => ok({ errcode: 40001, errmsg: 'invalid credential, corpsecret agent-secret-value' }));
    const client = new WecomClient({ id, config, fetch });
    await expect(client.getApplicationInfo()).rejects.toThrow('Failed to get access token (errcode 40001): invalid credential, corpsecret ***');
  });

  it('masks plain and URL-encoded values', () => {
    expect(redactValues('a se=cret+1 b se%3Dcret%2B1', ['se=cret+1'])).toBe('a *** b ***');
    expect(redactValues('short ab', ['ab', undefined])).toBe('short ab');
  });
});

describe('WeCom failure reason masking order (#1250 b111)', () => {
  it('masks the secret before it cuts, so a secret across the boundary is not half kept', async () => {
    const fetch = vi.fn(async () => ok({ errcode: 40001, errmsg: `${'x'.repeat(290)} agent-secret-value` }));
    const client = new WecomClient({ id, config, fetch });
    const error = await client.getApplicationInfo().catch((cause: unknown) => cause as Error);
    expect(error.message).toContain('Failed to get access token');
    expect(error.message).not.toMatch(/agent-s|secret-value/u);
  });
});
