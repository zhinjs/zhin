import { describe, expect, it } from 'vitest';
import { AiControlPlane, DecisionEventLog } from '@zhin.js/agent';
import { PluginConsoleRpcError } from '@zhin.js/plugin-runtime';
import { AssistantStatus } from '../../../src/plugin-runtime/console/assistant-status.js';
import {
  CONTROL_READ_PERMISSION,
  CONTROL_WRITE_PERMISSION,
  parseControlSetInput,
} from '../../../src/plugin-runtime/console/control-plane-rpc.js';

const signal = new AbortController().signal;

function harness() {
  const status = new AssistantStatus();
  const plane = new AiControlPlane();
  const log = new DecisionEventLog();
  status.bindControlPlane(() => plane, () => log);
  const call = (name: string, input: Record<string, unknown> = {}) =>
    Promise.resolve().then(() => status.consoleRpc.methods.get(name)!.handler(input as never, { signal })) as Promise<Record<string, any>>;
  return { status, plane, log, call };
}

describe('control plane Console RPC (ADR 0036 slice D)', () => {
  it('declares a read query and a write action with their own permissions', () => {
    const { status } = harness();
    const read = status.consoleRpc.methods.get('control')!;
    const write = status.consoleRpc.methods.get('control-set')!;
    expect(read).toMatchObject({ readOnly: true, requiredPermissions: [CONTROL_READ_PERMISSION] });
    expect(write).toMatchObject({ readOnly: false, requiredPermissions: [CONTROL_WRITE_PERMISSION] });
  });

  it('reads the instance defaults, overrides, revision and precedence', async () => {
    const { call } = harness();
    await expect(call('control')).resolves.toMatchObject({
      revision: 0,
      instance: { emergency_stop: false, muted: false, read_only: false, mention_only: false },
      sessions: [],
      persistent: false,
      available: true,
      precedence: ['emergency_stop', 'muted:instance', 'muted:session', 'read_only', 'mention_only'],
    });
  });

  it('sets with expectedRevision and writes control_change rows (actor=operator, before/after)', async () => {
    const { call, log, plane } = harness();
    const result = await call('control-set', {
      expectedRevision: 0,
      instance: { muted: true },
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { emergency_stop: true } }],
    });
    expect(result).toMatchObject({ revision: 1, changed: 2, instance: { muted: true }, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { emergency_stop: true } }] });
    expect(plane.isEmergencyStopped('icqq', 'group:g1')).toBe(true);
    await log.idle();
    const rows = log.recent();
    expect(rows.map((r) => [r.kind, r.actor, r.actorId, r.platform, r.sceneId])).toEqual([
      ['control_change', 'operator', 'console', '*', '*'],
      ['control_change', 'operator', 'console', 'icqq', 'group:g1'],
    ]);
    expect(rows[0]!.turnId).toBe(rows[1]!.turnId);
    expect(rows[0]!.payload).toMatchObject({ level: 'instance', revision: 1, before: { muted: false }, after: { muted: true } });
    expect(rows[1]!.payload).toMatchObject({ level: 'session', before: { emergency_stop: false }, after: { emergency_stop: true } });
  });

  it('a stale revision is a conflict and does not overwrite', async () => {
    const { call, plane, log } = harness();
    await call('control-set', { expectedRevision: 0, instance: { muted: true } });
    const stale = call('control-set', { expectedRevision: 0, instance: { muted: false } });
    await expect(stale).rejects.toBeInstanceOf(PluginConsoleRpcError);
    await expect(stale).rejects.toMatchObject({ code: 'conflict' });
    expect(plane.snapshot()).toMatchObject({ revision: 1, instance: { muted: true } });
    await log.idle();
    expect(log.recent()).toHaveLength(1);
  });

  it('rejects input without expectedRevision, unknown switches or fields', () => {
    expect(() => parseControlSetInput({ instance: { muted: true } })).toThrow(/expectedRevision/u);
    expect(() => parseControlSetInput({ expectedRevision: 0, instance: { silence: true } })).toThrow(/未知开关/u);
    expect(() => parseControlSetInput({ expectedRevision: 0, instance: { muted: 1 } })).toThrow(/true \/ false/u);
    expect(() => parseControlSetInput({ expectedRevision: 0, actorId: 'me', instance: { muted: true } })).toThrow(/不支持的字段/u);
    expect(() => parseControlSetInput({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'g1', flags: {} }] })).toThrow(/sceneId/u);
    expect(() => parseControlSetInput({ expectedRevision: 0 })).toThrow(/至少/u);
  });

  it('is unavailable before the Agent starts', async () => {
    const status = new AssistantStatus();
    const call = (name: string) => status.consoleRpc.methods.get(name)!.handler({ expectedRevision: 0, instance: { muted: true } } as never, { signal });
    await expect(Promise.resolve().then(() => call('control'))).rejects.toMatchObject({ code: 'unavailable' });
    await expect(Promise.resolve().then(() => call('control-set'))).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('refuses writes while the persisted state is unreadable (fail closed)', async () => {
    const { call, plane } = harness();
    await plane.upgradeToDatabase({
      select: () => ({ where: async () => { throw new Error('db down'); } }),
      create: async () => undefined,
      update: () => ({ where: async () => undefined }),
    } as never);
    await expect(call('control')).resolves.toMatchObject({ available: false });
    await expect(call('control-set', { expectedRevision: 0, instance: { muted: true } })).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('control plane Console RPC · cold-field temporary overrides (ADR 0037 slice C)', () => {
  it('shows temporary overrides with source and expiresAt without touching revision', async () => {
    const { call, plane } = harness();
    const entry = plane.addTemporaryMentionOnly({ platform: 'icqq', sceneId: 'group:g1', durationMs: 60_000 })!;
    await expect(call('control')).resolves.toMatchObject({
      revision: 0,
      sessions: [],
      temporary: [{ platform: 'icqq', sceneId: 'group:g1', switch: 'mention_only', source: 'cold_field', actor: 'policy', expiresAt: entry.expiresAt }],
    });
  });

  it('turning mention_only off manually clears the temporary override and audits cold_field_mention_only_cleared', async () => {
    const { call, plane, log } = harness();
    plane.addTemporaryMentionOnly({ platform: 'icqq', sceneId: 'group:g1', durationMs: 60_000 });
    const result = await call('control-set', {
      expectedRevision: 0,
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { mention_only: false } }],
    });
    expect(result).toMatchObject({ revision: 1, changed: 0, temporary: [] });
    await log.idle();
    const rows = log.recent();
    expect(rows.map((r) => [r.kind, r.reasonCode, r.actor, r.actorId, r.platform, r.sceneId])).toEqual([
      ['control_change', 'cold_field_mention_only_cleared', 'operator', 'console', 'icqq', 'group:g1'],
    ]);
    expect(rows[0]!.payload).toMatchObject({ level: 'policy', source: 'cold_field', switch: 'mention_only', revision: 1 });
  });
});
