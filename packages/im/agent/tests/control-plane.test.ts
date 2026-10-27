import { describe, expect, it, vi } from 'vitest';
import {
  AI_CONTROL_STATE_ROW_ID,
  AiControlPlane,
  CONTROL_OFF,
  CONTROL_STATE_RETRY_MS,
  ControlRevisionConflictError,
  ControlUnavailableError,
  ControlValidationError,
  evaluateControl,
  parseControlDocument,
  type ControlFlags,
  type ControlStateModel,
} from '../src/control-plane.js';
import { DECISION_REASON_CODES } from '../src/decision-events.js';

const flags = (on: Partial<ControlFlags>): ControlFlags => ({ ...CONTROL_OFF, ...on });
const code = (verdict: ReturnType<typeof evaluateControl>) => (verdict.blocked ? `${verdict.reasonCode}@${verdict.level}` : 'allow');

describe('evaluateControl precedence (ADR 0036 §2)', () => {
  it('emergency_stop → instance muted → session muted → read_only → mention_only → normal', () => {
    const all = flags({ emergency_stop: true, muted: true, read_only: true, mention_only: true });
    const allSession = { emergency_stop: true, muted: true, read_only: true, mention_only: true } as const;
    expect(code(evaluateControl(all, allSession, { addressed: false }))).toBe('control_emergency_stop@instance');
    expect(code(evaluateControl(flags({ muted: true, read_only: true, mention_only: true }), allSession, { addressed: false })))
      .toBe('control_emergency_stop@session');
    expect(code(evaluateControl(flags({ muted: true, read_only: true }), { muted: true, read_only: true, mention_only: true }, { addressed: false })))
      .toBe('control_muted_instance@instance');
    expect(code(evaluateControl(flags({ read_only: true, mention_only: true }), { muted: true }, { addressed: false })))
      .toBe('control_muted_session@session');
    expect(code(evaluateControl(flags({ read_only: true, mention_only: true }), {}, { addressed: false }))).toBe('control_read_only@instance');
    expect(code(evaluateControl(CONTROL_OFF, { read_only: true, mention_only: true }, { addressed: false }))).toBe('control_read_only@session');
    expect(code(evaluateControl(flags({ mention_only: true }), {}, { addressed: false }))).toBe('control_mention_only@instance');
    expect(code(evaluateControl(CONTROL_OFF, { mention_only: true }, { addressed: false }))).toBe('control_mention_only@session');
    expect(code(evaluateControl(CONTROL_OFF, {}, { addressed: false }))).toBe('allow');
  });

  it('mention_only lets addressed turns through; stop-class switches block them too', () => {
    expect(code(evaluateControl(flags({ mention_only: true }), { mention_only: true }, { addressed: true }))).toBe('allow');
    expect(code(evaluateControl(flags({ muted: true }), {}, { addressed: true }))).toBe('control_muted_instance@instance');
    expect(code(evaluateControl(CONTROL_OFF, { read_only: true }, { addressed: true }))).toBe('control_read_only@session');
  });

  it('mention_only is a skip, stop-class switches are denies', () => {
    const skip = evaluateControl(flags({ mention_only: true }), {}, { addressed: false });
    const deny = evaluateControl(flags({ read_only: true }), {}, { addressed: false });
    expect(skip.blocked && skip.outcome).toBe('skip');
    expect(deny.blocked && deny.outcome).toBe('deny');
  });

  it('only emits registered control_* reason codes', () => {
    const verdicts = [
      evaluateControl(flags({ emergency_stop: true }), {}, { addressed: true }),
      evaluateControl(flags({ muted: true }), {}, { addressed: true }),
      evaluateControl(CONTROL_OFF, { muted: true }, { addressed: true }),
      evaluateControl(flags({ read_only: true }), {}, { addressed: true }),
      evaluateControl(flags({ mention_only: true }), {}, { addressed: false }),
    ];
    for (const verdict of verdicts) {
      expect(verdict.blocked).toBe(true);
      if (verdict.blocked) expect(DECISION_REASON_CODES).toContain(verdict.reasonCode);
    }
  });
});

describe('AiControlPlane', () => {
  const g1 = { platform: 'icqq', sceneId: 'group:g1' };

  it('session overrides can only be stricter: false never relaxes an instance switch', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, instance: { emergency_stop: true, muted: true }, actorId: 'op' });
    const result = await plane.set({
      expectedRevision: 1,
      sessions: [{ ...g1, flags: { emergency_stop: false, muted: false, mention_only: true } }],
      actorId: 'op',
    });
    expect(plane.gate({ ...g1, addressed: true })).toMatchObject({ blocked: true, reasonCode: 'control_emergency_stop', level: 'instance' });
    expect(plane.effective(g1.platform, g1.sceneId)).toEqual(flags({ emergency_stop: true, muted: true, mention_only: true }));
    // 只记打开的开关
    expect(result.snapshot.sessions).toEqual([{ ...g1, flags: { mention_only: true } }]);
  });

  it('scopes session overrides to platform + scene_id', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, sessions: [{ ...g1, flags: { muted: true } }], actorId: 'op' });
    expect(plane.gate({ ...g1, addressed: true })).toMatchObject({ blocked: true, reasonCode: 'control_muted_session' });
    expect(plane.gate({ platform: 'icqq', sceneId: 'group:g2', addressed: true })).toEqual({ blocked: false });
    expect(plane.gate({ platform: 'qq', sceneId: 'group:g1', addressed: true })).toEqual({ blocked: false });
  });

  it('turning every switch of a session off removes the override', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, sessions: [{ ...g1, flags: { muted: true } }], actorId: 'op' });
    const off = await plane.set({ expectedRevision: 1, sessions: [{ ...g1, flags: { muted: false } }], actorId: 'op' });
    expect(off.snapshot.sessions).toEqual([]);
    expect(off.changes).toEqual([{ scope: { level: 'session', ...g1 }, before: flags({ muted: true }), after: CONTROL_OFF }]);
  });

  it('requires the current revision; a stale write is rejected and changes nothing', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, instance: { muted: true }, actorId: 'op' });
    await expect(plane.set({ expectedRevision: 0, instance: { muted: false }, actorId: 'op' })).rejects.toBeInstanceOf(ControlRevisionConflictError);
    expect(plane.snapshot()).toMatchObject({ revision: 1, instance: flags({ muted: true }) });
  });

  it('serializes concurrent writes: the second one with the same revision conflicts', async () => {
    const plane = new AiControlPlane();
    const [a, b] = await Promise.allSettled([
      plane.set({ expectedRevision: 0, instance: { muted: true }, actorId: 'a' }),
      plane.set({ expectedRevision: 0, instance: { read_only: true }, actorId: 'b' }),
    ]);
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('rejected');
    expect(plane.snapshot().instance).toEqual(flags({ muted: true }));
  });

  it('validates switches and session keys', async () => {
    const plane = new AiControlPlane();
    await expect(plane.set({ expectedRevision: 0, instance: { nope: true } as never, actorId: 'op' })).rejects.toBeInstanceOf(ControlValidationError);
    await expect(plane.set({ expectedRevision: 0, instance: { muted: 'yes' } as never, actorId: 'op' })).rejects.toBeInstanceOf(ControlValidationError);
    await expect(plane.set({ expectedRevision: 0, sessions: [{ platform: 'icqq', sceneId: 'g1', flags: { muted: true } }], actorId: 'op' }))
      .rejects.toBeInstanceOf(ControlValidationError);
    await expect(plane.set({ expectedRevision: 0, instance: { muted: true }, actorId: '' })).rejects.toBeInstanceOf(ControlValidationError);
    expect(plane.snapshot().revision).toBe(0);
  });

  it('outboundGate ignores mention_only but blocks stop-class switches', async () => {
    const plane = new AiControlPlane();
    await plane.set({ expectedRevision: 0, instance: { mention_only: true }, actorId: 'op' });
    expect(plane.outboundGate(g1.platform, g1.sceneId)).toEqual({ blocked: false });
    await plane.set({ expectedRevision: 1, sessions: [{ ...g1, flags: { read_only: true } }], actorId: 'op' });
    expect(plane.outboundGate(g1.platform, g1.sceneId)).toMatchObject({ blocked: true, reasonCode: 'control_read_only' });
  });

  it('exposes emergency_stop / read_only for the hard gate (slice E)', async () => {
    const plane = new AiControlPlane();
    expect(plane.isEmergencyStopped()).toBe(false);
    await plane.set({ expectedRevision: 0, sessions: [{ ...g1, flags: { emergency_stop: true } }], actorId: 'op' });
    expect(plane.isEmergencyStopped()).toBe(false);
    expect(plane.isEmergencyStopped(g1.platform, g1.sceneId)).toBe(true);
    expect(plane.isReadOnly(g1.platform, g1.sceneId)).toBe(true);
    await plane.set({ expectedRevision: 1, instance: { read_only: true }, actorId: 'op' });
    expect(plane.isReadOnly()).toBe(true);
  });
});

function memoryModel(initial?: Record<string, unknown>) {
  let row = initial ? { ...initial } : undefined;
  const model = {
    select: vi.fn(() => ({ where: async () => (row ? [{ ...row }] : []) })),
    create: vi.fn(async (value: Record<string, unknown>) => { row = { ...value }; }),
    update: vi.fn((value: Record<string, unknown>) => ({ where: async () => { row = { ...row, ...value }; } })),
    get row() { return row; },
  };
  return model;
}

describe('AiControlPlane persistence', () => {
  it('writes one row and restores it after a restart', async () => {
    const model = memoryModel();
    const first = new AiControlPlane(() => 100);
    await first.upgradeToDatabase(model as unknown as ControlStateModel);
    await first.set({ expectedRevision: 0, instance: { emergency_stop: true }, actorId: 'op' });
    await first.set({ expectedRevision: 1, sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { muted: true } }], actorId: 'op' });
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(model.update).toHaveBeenCalledTimes(1);
    expect(model.row).toMatchObject({ id: AI_CONTROL_STATE_ROW_ID, revision: 2, updated_by: 'op', updated_at: 100 });

    const second = new AiControlPlane();
    await second.upgradeToDatabase(model as unknown as ControlStateModel);
    expect(second.snapshot()).toMatchObject({
      revision: 2, persistent: true, available: true,
      instance: flags({ emergency_stop: true }),
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', flags: { muted: true } }],
    });
    expect(second.isEmergencyStopped()).toBe(true);
  });

  it('a failed write leaves the switches unchanged', async () => {
    const model = memoryModel();
    model.create.mockRejectedValueOnce(new Error('db down'));
    const plane = new AiControlPlane();
    await plane.upgradeToDatabase(model as unknown as ControlStateModel);
    await expect(plane.set({ expectedRevision: 0, instance: { muted: true }, actorId: 'op' })).rejects.toThrow('db down');
    expect(plane.snapshot()).toMatchObject({ revision: 0, instance: CONTROL_OFF });
  });

  it('fails closed when the persisted state cannot be read, then retries', async () => {
    let now = 1_000;
    const model = memoryModel({ id: AI_CONTROL_STATE_ROW_ID, revision: 3, state: JSON.stringify({ instance: {} }) });
    const healthy = model.select.getMockImplementation()!;
    model.select.mockImplementation(() => ({ where: async () => { throw new Error('db down'); } }) as never);
    const plane = new AiControlPlane(() => now);
    await expect(plane.upgradeToDatabase(model as unknown as ControlStateModel)).resolves.toBe(false);
    expect(plane.available).toBe(false);
    expect(plane.gate({ platform: 'icqq', sceneId: 'group:g1', addressed: true }))
      .toMatchObject({ blocked: true, reasonCode: 'control_emergency_stop', level: 'unavailable' });
    expect(plane.isEmergencyStopped()).toBe(true);
    await expect(plane.set({ expectedRevision: 3, instance: { muted: true }, actorId: 'op' })).rejects.toBeInstanceOf(ControlUnavailableError);

    model.select.mockImplementation(healthy);
    now += CONTROL_STATE_RETRY_MS;
    plane.gate({ platform: 'icqq', sceneId: 'group:g1', addressed: true });
    await vi.waitFor(() => expect(plane.available).toBe(true));
    expect(plane.gate({ platform: 'icqq', sceneId: 'group:g1', addressed: true })).toEqual({ blocked: false });
    expect(plane.snapshot().revision).toBe(3);
  });

  it('treats a corrupt document as unavailable (fail closed)', async () => {
    const model = memoryModel({ id: AI_CONTROL_STATE_ROW_ID, revision: 1, state: '{not json' });
    const plane = new AiControlPlane();
    await plane.upgradeToDatabase(model as unknown as ControlStateModel);
    expect(plane.available).toBe(false);
    expect(() => parseControlDocument('{"sessions":{}}')).toThrow(ControlValidationError);
  });
});
