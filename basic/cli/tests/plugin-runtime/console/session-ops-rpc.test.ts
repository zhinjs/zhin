import { describe, expect, it, vi } from 'vitest';
import { AiSessionOps, DecisionEventLog } from '@zhin.js/agent';
import { PluginConsoleRpcError } from '@zhin.js/plugin-runtime';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import {
  SESSION_OPS_READ_PERMISSION,
  SESSION_OPS_WRITE_PERMISSION,
} from '../../../src/plugin-runtime/console/session-ops-rpc.js';
import { MemberLifecycle } from '../../../src/plugin-runtime/agent/turn/member-lifecycle.js';

const signal = new AbortController().signal;

function harness(options: { bound?: boolean } = {}) {
  const status = new AssistantStatus();
  const ops = new AiSessionOps();
  const log = new DecisionEventLog();
  const send = vi.fn(async () => ({ status: 'sent' as const }));
  const lifecycle = new MemberLifecycle({ sessionOps: () => ops, sessions: () => undefined, reader: () => undefined, decisionEvents: () => log, send });
  if (options.bound !== false) status.bindSessionOps(() => ops, () => lifecycle, () => log);
  const call = (name: string, input: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => status.consoleRpc.methods.get(name)!.handler(input as never, { signal })) as Promise<Record<string, any>>;
  return { status, ops, log, send, call };
}

describe('session ops Console RPC (ADR 0037 slice A)', () => {
  it('declares read queries (incl. preview) and a write action', () => {
    const { status } = harness();
    expect(status.consoleRpc.methods.get('session-ops')).toMatchObject({ readOnly: true, requiredPermissions: [SESSION_OPS_READ_PERMISSION] });
    expect(status.consoleRpc.methods.get('session-ops-preview')).toMatchObject({ readOnly: true, requiredPermissions: [SESSION_OPS_READ_PERMISSION] });
    expect(status.consoleRpc.methods.get('session-ops-set')).toMatchObject({ readOnly: false, requiredPermissions: [SESSION_OPS_WRITE_PERMISSION] });
    // control plane methods are still there.
    expect(status.consoleRpc.methods.get('control-set')).toBeDefined();
  });

  it('reads defaults (welcome off) and revision', async () => {
    const { call } = harness();
    await expect(call('session-ops')).resolves.toMatchObject({
      revision: 0,
      defaults: { welcome: { enabled: false, mergeWindowMs: 60_000, maxPerHour: 10 }, leave: { record: true, notify: false } },
      sessions: [],
      available: true,
    });
  });

  it('sets with expectedRevision and writes config_change rows', async () => {
    const { call, log, ops } = harness();
    const result = await call('session-ops-set', {
      expectedRevision: 0,
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true, template: '欢迎 {members}' } }],
    });
    expect(result).toMatchObject({ revision: 1, changed: 1, sessions: [{ platform: 'icqq', sceneId: 'group:g1', effective: { welcome: { enabled: true, template: '欢迎 {members}' } } }] });
    expect(ops.resolve('icqq', 'group:g1').welcome.enabled).toBe(true);
    await log.idle();
    const [row] = log.recent();
    expect([row!.kind, row!.actor, row!.actorId, row!.platform, row!.sceneId]).toEqual(['config_change', 'operator', 'console', 'icqq', 'group:g1']);
    expect(row!.payload).toMatchObject({ area: 'session_ops', before: { welcome: { enabled: false } }, after: { welcome: { enabled: true } } });
  });

  it('conflict on a stale revision, invalid_input on bad fields', async () => {
    const { call } = harness();
    await call('session-ops-set', { expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true } }] });
    await expect(call('session-ops-set', { expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: false } }] }))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(call('session-ops-set', { sessions: [] })).rejects.toBeInstanceOf(PluginConsoleRpcError);
    await expect(call('session-ops-set', { expectedRevision: 1, defaults: { welcome: { enabled: true } } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call('session-ops-set', { expectedRevision: 1, extra: 1 })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('preview renders without sending or auditing and flags unknown vars', async () => {
    const { call, send, log } = harness();
    const preview = await call('session-ops-preview', { platform: 'icqq', sceneId: 'group:g1', template: '欢迎 {nickname}，看 {rules}' });
    expect(preview).toMatchObject({ text: '欢迎 新同学，看 {rules}', unknownVars: ['rules'], sample: true, enabled: false });
    expect(send).not.toHaveBeenCalled();
    await log.idle();
    expect(log.recent()).toEqual([]);
    await expect(call('session-ops-preview', { platform: 'icqq', sceneId: 'private:u1' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('unavailable before the Agent binds', async () => {
    const { call } = harness({ bound: false });
    await expect(call('session-ops')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(call('session-ops-preview', { platform: 'icqq', sceneId: 'group:g1' })).rejects.toMatchObject({ code: 'unavailable' });
  });
});
