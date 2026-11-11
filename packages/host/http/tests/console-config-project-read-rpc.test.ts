import { describe, expect, it, vi } from 'vitest';
import { consoleRpcPermission } from '@zhin.js/console-protocol';
import { VIEWER } from './fixtures/principals.js';
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

  it('needs ops.config.read (not held by viewers) and validates the request shape before reading', async () => {
    expect(consoleRpcPermission(method)).toBe('ops.config.read');
    const readProjectConfig = vi.fn(async () => result);
    for (const [extra, authScope] of [
      [{}, 'viewer'], [{ path: 'http.token' }, 'full'], [{ path: [''] }, 'full'], [{ path: [1] }, 'full'],
      [{ path: Array.from({ length: 17 }, () => 'a') }, 'full'], [{ reveal: 'yes' }, 'full'],
    ] as const) {
      const request = { type: method, requestId: 1, ...extra };
      const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, {
        authScope: 'full', ...(authScope === 'viewer' ? { principal: VIEWER } : {}), listPages: async () => [], readProjectConfig,
      }));
      expect(reply?.error).toEqual(expect.any(String));
    }
    expect(readProjectConfig).not.toHaveBeenCalled();
  });

  it('never echoes the read failure text, which can quote document source', async () => {
    const readProjectConfig = vi.fn(async () => { throw new Error('YAML parse error near "token: synthetic-secret"'); });
    const request = { type: method, requestId: 1 };
    const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, { authScope: 'full', listPages: async () => [], readProjectConfig }));
    expect(reply?.error).toEqual(expect.any(String));
    expect(reply?.error).not.toContain('synthetic-secret');
  });
});

describe('trusted project configuration patch RPC', () => {
  it('a committed save stays a saved receipt even when publishing the update event throws', async () => {
    const saved = { status: 'saved', revision: 'b'.repeat(64), restartRequired: false, paths: [['log_level']], missingEnv: [], message: 'ok' } as const;
    const patchProjectConfig = vi.fn(async () => saved);
    const publishEvent = vi.fn(() => { throw new Error('subscriber failed'); });
    const request = { type: 'config:patch-project', requestId: 1, expectedRevision: 'a'.repeat(64), patches: [{ op: 'set', path: ['log_level'], value: 'debug' }] };
    const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, {
      authScope: 'full', listPages: async () => [], patchProjectConfig, publishEvent,
    } as Parameters<typeof dispatchRuntimeConsoleRpc>[1]));
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(reply?.error).toBeUndefined();
    expect(reply?.data).toEqual(saved);
  });
});
