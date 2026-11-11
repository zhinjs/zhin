import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { DingTalkClient } from '../src/client.js';
import { resolveDingTalkConfig } from '../src/protocol.js';

const config = resolveDingTalkConfig({
  id: 'timeout-bot', appKey: 'app-key', appSecret: 'app-secret', robotCode: 'robot-1',
  apiBaseUrl: 'https://oapi.example.test',
});
const id = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'dingtalk');
const ok = (data: unknown) => ({ ok: true, status: 200, text: async () => '', json: async () => data });

describe('DingTalk access-token refresh lifetime', () => {
  it('bounds the shared token refresh with a timeout signal', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetch = vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      if (url.includes('/gettoken')) { signals.push(init?.signal); return ok({ errcode: 0, access_token: 'tok', expires_in: 7200 }); }
      return ok({ errcode: 0, result: { userid: 'u1' } });
    });
    const client = new DingTalkClient({ id, config, fetch });
    await expect(client.getUserInfo('u1')).resolves.toEqual({ userid: 'u1' });
    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]!.aborted).toBe(false);
  });

  it('does not parse a non-2xx token response and recovers on the next call', async () => {
    const json = vi.fn(async () => { throw new SyntaxError('Unexpected token <'); });
    let attempt = 0;
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/gettoken')) return ++attempt === 1 ? { ok: false, status: 502, text: async () => '<html>', json } : ok({ errcode: 0, access_token: 'tok', expires_in: 7200 });
      return ok({ errcode: 0, result: { userid: 'u1' } });
    });
    const client = new DingTalkClient({ id, config, fetch });
    // getUserInfo logs and returns null on failure.
    await expect(client.getUserInfo('u1')).resolves.toBeNull();
    expect(json).not.toHaveBeenCalled();
    await expect(client.getUserInfo('u1')).resolves.toEqual({ userid: 'u1' });
    expect(attempt).toBe(2);
  });
});
