import { describe, expect, it } from 'vitest';
import { DEMO_RPC_WRITE_BLOCKLIST } from '@zhin.js/console-protocol';
import { dispatchRuntimeConsoleRpc, pickRpcReply } from '../src/console-rpc.js';

const method = 'config:patch-project';
const revision = 'a'.repeat(64);
const patches = [{ op: 'set', path: ['ai', 'enabled'], value: true }];
const message = (extra: Record<string, unknown> = {}) => ({ type: method, requestId: 1, expectedRevision: revision, patches, ...extra });
const saved = { status: 'saved', revision, restartRequired: false, paths: [['ai', 'enabled']], missingEnv: [], message: '' } as const;

describe('trusted project configuration patch RPC', () => {
  it('uses its dedicated project port and publishes only after saving', async () => {
    const patchProjectConfig = vi.fn(async () => saved);
    const patchConfig = vi.fn();
    const publishEvent = vi.fn();
    const request = message();
    const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, {
      authScope: 'full', listPages: async () => [], patchProjectConfig, patchConfig, publishEvent,
    }));
    expect(reply?.data).toEqual(saved);
    expect(patchProjectConfig).toHaveBeenCalledExactlyOnceWith({ expectedRevision: revision, patches });
    expect(patchConfig).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalledExactlyOnceWith('config:updated', {
      pluginName: null, keys: ['ai'], paths: saved.paths, revision,
    });
  });

  it('rejects demo, missing revision, malformed patch operations and scoped-field ambiguity before a write', async () => {
    const patchProjectConfig = vi.fn(async () => saved);
    for (const [extra, authScope] of [
      [{}, 'demo'], [{ expectedRevision: undefined }, 'full'], [{ expectedRevision: 'stale' }, 'full'], [{ patches: null }, 'full'],
      [{ instanceKey: 'bot' }, 'full'], [{ patches: [] }, 'full'], [{ patches: [null] }, 'full'],
      [{ patches: [{ op: 'set' }] }, 'full'], [{ patches: [{ op: 'set', path: ['ai'] }] }, 'full'],
      [{ patches: [{ op: 'move', path: ['ai'] }] }, 'full'], [{ patches: [{ op: 'remove', path: ['__proto__'] }] }, 'full'],
      [{ patches: [{ op: 'remove', path: [''] }] }, 'full'],
      [{ patches: Array.from({ length: 33 }, () => ({ op: 'remove', path: ['ai'] })) }, 'full'],
      [{ patches: [{ op: 'remove', path: Array.from({ length: 17 }, () => 'a') }] }, 'full'],
    ] as const) {
      const request = message(extra);
      const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, {
        authScope, listPages: async () => [], patchProjectConfig,
      }));
      expect(reply?.error).toBeTruthy();
    }
    expect(patchProjectConfig).not.toHaveBeenCalled();
    expect(DEMO_RPC_WRITE_BLOCKLIST.has(method)).toBe(true);
  });

  it('returns conflicts unchanged without publishing or falling back to ordinary patches', async () => {
    const conflict = { status: 'conflict', revision, current: [], message: 'changed' } as const;
    const publishEvent = vi.fn();
    const request = message();
    const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, {
      authScope: 'full', listPages: async () => [], patchProjectConfig: async () => conflict, publishEvent,
    }));
    expect(reply?.data).toEqual(conflict);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('preserves a storage acknowledgement uncertainty without publishing a false save or returning an error', async () => {
    const unconfirmed = { status: 'unconfirmed', expectedRevision: revision, message: '保存结果未确认' } as const;
    const publishEvent = vi.fn();
    const request = message();
    const reply = pickRpcReply(request, await dispatchRuntimeConsoleRpc(request, {
      authScope: 'full', listPages: async () => [], patchProjectConfig: async () => unconfirmed, publishEvent,
    }));
    expect(reply?.data).toEqual(unconfirmed);
    expect(reply?.error).toBeUndefined();
    expect(publishEvent).not.toHaveBeenCalled();
  });
});
