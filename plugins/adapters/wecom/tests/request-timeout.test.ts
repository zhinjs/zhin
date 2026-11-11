import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { WecomClient } from '../src/client.js';
import { resolveWecomConfig } from '../src/protocol.js';

const config = resolveWecomConfig({
  id: 'timeout-bot', corpId: 'corp&id', agentId: '1000002', agentSecret: 'se=cret+1',
  token: 'synthetic-token', encodingAESKey: Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''),
  apiBaseUrl: 'https://qyapi.example.test',
});
const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'wecom');
const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => '', json: async () => data });

describe('WeCom API request lifetime', () => {
  it('bounds the shared token refresh and the API request with a timeout signal and encodes credentials', async () => {
    const calls: { url: string; signal?: AbortSignal }[] = [];
    const fetch = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      calls.push({ url, signal: init?.signal });
      return url.includes('/gettoken') ? ok({ errcode: 0, access_token: 'tok', expires_in: 7200 }) : ok({ errcode: 0, agentid: 1000002 });
    });
    const client = new WecomClient({ id, config, fetch });
    const caller = new AbortController();
    await client.getApplicationInfo({ signal: caller.signal });

    expect(calls).toHaveLength(2);
    const token = new URL(calls[0].url);
    expect(token.pathname).toBe('/cgi-bin/gettoken');
    expect(token.searchParams.get('corpid')).toBe('corp&id');
    expect(token.searchParams.get('corpsecret')).toBe('se=cret+1');
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].signal!.aborted).toBe(false);
    // The API request combines the caller signal with the timeout.
    expect(calls[1].signal).toBeInstanceOf(AbortSignal);
    expect(calls[1].signal).not.toBe(caller.signal);
    caller.abort();
    expect(calls[1].signal!.aborted).toBe(true);
    // The shared refresh is not tied to one caller.
    expect(calls[0].signal!.aborted).toBe(false);
  });

  it('reports a non-2xx token response by status instead of parsing its body', async () => {
    const json = vi.fn(async () => { throw new SyntaxError('Unexpected token <'); });
    const fetch = vi.fn(async () => ({ ok: false, status: 502, text: async () => '<html>', json }));
    const client = new WecomClient({ id, config, fetch });
    await expect(client.getApplicationInfo()).rejects.toThrow('Failed to get access token: HTTP 502');
    expect(json).not.toHaveBeenCalled();
  });

  it('lets a later caller refresh again after a failed refresh', async () => {
    let attempt = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/gettoken')) return ++attempt === 1 ? { ok: false, status: 503, text: async () => '', json: async () => ({}) } : ok({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      return ok({ errcode: 0, agentid: 1000002 });
    });
    const client = new WecomClient({ id, config, fetch });
    await expect(client.getApplicationInfo()).rejects.toThrow('HTTP 503');
    await expect(client.getApplicationInfo()).resolves.toMatchObject({ agentid: 1000002 });
  });
});
