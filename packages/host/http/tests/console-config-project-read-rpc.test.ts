import { describe, expect, it, vi } from 'vitest';
import { DEMO_RPC_ALLOWLIST } from '@zhin.js/console-protocol';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '../src/console-rpc.js';

const method = 'config:get-project';
const result = { revision: 'a'.repeat(64), path: ['http', 'token'], exists: true, value: '[redacted]', redacted: true } as const;

describe('trusted project configuration read RPC', () => {
  it('forwards path and reveal (default false) to the project read port', async () => {
    const readProjectConfig = vi.fn(async () => result);
    for (const [extra, expected] of [
      [{ path: ['http', 'token'] }, { path: ['http', 'token'], reveal: false }],
      [{ path: ['http', 'token'], reveal: true }, { path: ['http', 'token'], reveal: true }],
      [{}, { path: [], reveal: false }],
    ] as const) {
      const request = { type: method, requestId: 1, ...extra };
      const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { authScope: 'full', listPages: async () => [], readProjectConfig }));
      expect(reply?.data).toEqual(result);
      expect(readProjectConfig).toHaveBeenLastCalledWith(expected);
    }
  });

  it('is full-scope only, not demo-readable, and validates the request shape before reading', async () => {
    expect(DEMO_RPC_ALLOWLIST.has(method)).toBe(false);
    const readProjectConfig = vi.fn(async () => result);
    for (const [extra, authScope] of [
      [{}, 'demo'], [{ path: 'http.token' }, 'full'], [{ path: [''] }, 'full'], [{ path: [1] }, 'full'],
      [{ path: Array.from({ length: 17 }, () => 'a') }, 'full'], [{ reveal: 'yes' }, 'full'],
    ] as const) {
      const request = { type: method, requestId: 1, ...extra };
      const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { authScope, listPages: async () => [], readProjectConfig }));
      expect(reply?.error).toEqual(expect.any(String));
    }
    expect(readProjectConfig).not.toHaveBeenCalled();
  });
});
