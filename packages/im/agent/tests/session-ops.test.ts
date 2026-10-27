import { describe, expect, it } from 'vitest';
import {
  AI_SESSION_OPS_ROW_ID,
  AiSessionOps,
  BUILTIN_SESSION_OPS_DEFAULTS,
  DEFAULT_WELCOME_TEMPLATE,
  SESSION_OPS_RETRY_MS,
  SessionOpsRevisionConflictError,
  SessionOpsUnavailableError,
  SessionOpsValidationError,
  parseSessionOpsDocument,
  renderWelcomeTemplate,
  unknownTemplateVars,
  type SessionOpsModel,
} from '../src/session-ops.js';

function memoryModel(initial?: Record<string, unknown>) {
  const rows: Record<string, unknown>[] = initial ? [{ ...initial }] : [];
  let failReads = false;
  let failWrites = false;
  const model: SessionOpsModel = {
    select: () => {
      const run = async () => {
        if (failReads) throw new Error('db down');
        return rows.map((row) => ({ ...row }));
      };
      return { where: () => run(), then: (ok: never, fail: never) => run().then(ok, fail) } as never;
    },
    create: async (row) => {
      if (failWrites) throw new Error('write failed');
      rows.push({ ...row });
    },
    update: (row) => ({
      where: async () => {
        if (failWrites) throw new Error('write failed');
        Object.assign(rows[0]!, row);
      },
    }),
  };
  return {
    model,
    rows,
    failReads: (value: boolean) => { failReads = value; },
    failWrites: (value: boolean) => { failWrites = value; },
  };
}

describe('renderWelcomeTemplate (ADR 0037 §1.1)', () => {
  it('replaces whitelisted vars: {members} as mentions, {nickname}, {group}, {rules_url}', () => {
    const out = renderWelcomeTemplate('欢迎 {members}（{nickname}）加入 {group}，群规：{rules_url}', {
      members: [{ id: 'u1', name: '阿强' }, { id: 'u2' }],
      group: '测试社团',
      rulesUrl: 'https://example.com/rules',
    });
    expect(out.parts).toEqual([
      { type: 'text', text: '欢迎 ' },
      { type: 'mention', id: 'u1', name: '阿强' },
      { type: 'text', text: ' ' },
      { type: 'mention', id: 'u2' },
      { type: 'text', text: '（阿强、u2）加入 测试社团，群规：https://example.com/rules' },
    ]);
    expect(out.text).toBe('欢迎 @阿强 @u2（阿强、u2）加入 测试社团，群规：https://example.com/rules');
    expect(out.unknownVars).toEqual([]);
  });

  it('keeps unknown vars as-is and reports them once, without throwing', () => {
    const out = renderWelcomeTemplate('Hi {nickname} {foo} {foo} {bar_1} {rules_url}', { members: [{ id: 'u1', name: 'A' }], group: 'g' });
    expect(out.text).toBe('Hi A {foo} {foo} {bar_1} ');
    expect(out.unknownVars).toEqual(['foo', 'bar_1']);
    expect(unknownTemplateVars('{members}{x}{group}')).toEqual(['x']);
  });

  it('renders the built-in default template', () => {
    expect(renderWelcomeTemplate(DEFAULT_WELCOME_TEMPLATE, { members: [{ id: 'u1', name: '新人' }], group: '社团' }).text)
      .toBe('欢迎 @新人 加入社团！');
  });
});

describe('AiSessionOps', () => {
  it('defaults: welcome off, 60s merge window, 10/hour, leave record on, notify off', () => {
    const ops = new AiSessionOps();
    expect(ops.resolve('icqq', 'group:g1')).toEqual(BUILTIN_SESSION_OPS_DEFAULTS);
    expect(BUILTIN_SESSION_OPS_DEFAULTS).toMatchObject({
      welcome: { enabled: false, mergeWindowMs: 60_000, maxPerHour: 10 },
      leave: { record: true, notify: false },
    });
  });

  it('keys sessions by platform + sceneId and falls back to instance defaults', async () => {
    const ops = new AiSessionOps();
    const result = await ops.set({
      expectedRevision: 0,
      actorId: 'console',
      defaults: { welcome: { template: '欢迎 {nickname}', maxPerHour: 5 } },
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true, mergeWindowMs: 0 } }],
    });
    expect(result.snapshot.revision).toBe(1);
    expect(result.changes.map((change) => change.scope.level)).toEqual(['instance', 'session']);
    expect(ops.resolve('icqq', 'group:g1').welcome).toMatchObject({ enabled: true, template: '欢迎 {nickname}', maxPerHour: 5, mergeWindowMs: 0 });
    expect(ops.resolve('icqq', 'group:g2').welcome.enabled).toBe(false);
    expect(ops.resolve('qq', 'group:g1').welcome.enabled).toBe(false);
    // null clears a session override; reset drops the whole entry.
    await ops.set({ expectedRevision: 1, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { mergeWindowMs: null } }] });
    expect(ops.resolve('icqq', 'group:g1').welcome).toMatchObject({ enabled: true, mergeWindowMs: 60_000 });
    await ops.set({ expectedRevision: 2, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', reset: true }] });
    expect(ops.snapshot().sessions).toEqual([]);
  });

  it('rejects instance-level switches, bad scopes and out-of-range values', async () => {
    const ops = new AiSessionOps();
    const bad = [
      { defaults: { welcome: { enabled: true } } },
      { defaults: { leave: { notify: true } } },
      { sessions: [{ platform: 'icqq', sceneId: 'private:u1', welcome: { enabled: true } }] },
      { sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { maxPerHour: 0 } }] },
      { sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { mergeWindowMs: 3_600_000 } }] },
      { sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { template: '' } }] },
      { sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { colour: 'red' } }] },
    ];
    for (const input of bad) {
      await expect(ops.set({ expectedRevision: 0, actorId: 'console', ...input } as never)).rejects.toBeInstanceOf(SessionOpsValidationError);
    }
    expect(ops.snapshot().revision).toBe(0);
  });

  it('carries ops.cooldownMs (ADR 0037 slice E): 60s default, instance default + session override, null clears', async () => {
    const ops = new AiSessionOps();
    expect(ops.resolve('icqq', 'group:g1').ops).toEqual({ cooldownMs: 60_000 });
    // Private scenes cannot carry overrides but still resolve the instance default.
    expect(ops.resolve('icqq', 'private:u1').ops.cooldownMs).toBe(60_000);
    const result = await ops.set({
      expectedRevision: 0,
      actorId: 'console',
      defaults: { ops: { cooldownMs: 120_000 } },
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', ops: { cooldownMs: 5_000 } }],
    });
    expect(result.changes.map((change) => change.scope.level)).toEqual(['instance', 'session']);
    expect(ops.resolve('icqq', 'group:g1').ops.cooldownMs).toBe(5_000);
    expect(ops.resolve('icqq', 'group:g2').ops.cooldownMs).toBe(120_000);
    await ops.set({ expectedRevision: 1, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', ops: { cooldownMs: null } }] });
    expect(ops.resolve('icqq', 'group:g1').ops.cooldownMs).toBe(120_000);
    expect(ops.snapshot().sessions).toEqual([]);
    for (const bad of [{ defaults: { ops: { cooldownMs: -1 } } }, { defaults: { ops: { cooldownMs: 86_400_001 } } },
      { defaults: { ops: { window: 1 } } }, { sessions: [{ platform: 'icqq', sceneId: 'group:g1', ops: { cooldownMs: 1.5 } }] }]) {
      await expect(ops.set({ expectedRevision: 2, actorId: 'console', ...bad } as never)).rejects.toBeInstanceOf(SessionOpsValidationError);
    }
  });

  it('persists ops.cooldownMs and keeps it when the store becomes unavailable', () => {
    const parsed = parseSessionOpsDocument(JSON.stringify({
      defaults: { ops: { cooldownMs: 30_000 } },
      sessions: [{ platform: 'icqq', sceneId: 'group:g1', overrides: { ops: { cooldownMs: 0 } } }],
    }));
    expect(parsed.defaults.ops.cooldownMs).toBe(30_000);
    expect(parsed.sessions[0]!.overrides.ops).toEqual({ cooldownMs: 0 });
  });

  it('refuses a stale expectedRevision without overwriting', async () => {
    const ops = new AiSessionOps();
    await ops.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true } }] });
    await expect(ops.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: false } }] }))
      .rejects.toBeInstanceOf(SessionOpsRevisionConflictError);
    expect(ops.resolve('icqq', 'group:g1').welcome.enabled).toBe(true);
  });

  it('persists to ai_session_ops and restores after restart', async () => {
    const db = memoryModel();
    const first = new AiSessionOps();
    await first.upgradeToDatabase(db.model);
    await first.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true, rulesUrl: 'https://r' } }] });
    expect(db.rows[0]).toMatchObject({ id: AI_SESSION_OPS_ROW_ID, revision: 1, updated_by: 'console' });
    const second = new AiSessionOps();
    await second.upgradeToDatabase(db.model);
    expect(second.resolve('icqq', 'group:g1').welcome).toMatchObject({ enabled: true, rulesUrl: 'https://r' });
    expect(second.snapshot()).toMatchObject({ revision: 1, persistent: true, available: true });
  });

  it('a failed write leaves memory unchanged', async () => {
    const db = memoryModel();
    const ops = new AiSessionOps();
    await ops.upgradeToDatabase(db.model);
    db.failWrites(true);
    await expect(ops.set({ expectedRevision: 0, actorId: 'console', sessions: [{ platform: 'icqq', sceneId: 'group:g1', welcome: { enabled: true } }] }))
      .rejects.toThrow('write failed');
    expect(ops.resolve('icqq', 'group:g1').welcome.enabled).toBe(false);
    expect(ops.snapshot().revision).toBe(0);
  });

  it('unreadable state: never welcomes, keeps leave records, refuses writes, retries later', async () => {
    let now = 1_000;
    const db = memoryModel({
      id: AI_SESSION_OPS_ROW_ID,
      revision: 3,
      state: JSON.stringify({ sessions: [{ platform: 'icqq', sceneId: 'group:g1', overrides: { welcome: { enabled: true } } }] }),
    });
    db.failReads(true);
    const ops = new AiSessionOps(() => now);
    expect(await ops.upgradeToDatabase(db.model)).toBe(false);
    expect(ops.resolve('icqq', 'group:g1')).toMatchObject({ welcome: { enabled: false }, leave: { record: true } });
    await expect(ops.set({ expectedRevision: 3, actorId: 'console', sessions: [] })).rejects.toBeInstanceOf(SessionOpsUnavailableError);
    db.failReads(false);
    now += SESSION_OPS_RETRY_MS;
    ops.resolve('icqq', 'group:g1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ops.available).toBe(true);
    expect(ops.resolve('icqq', 'group:g1').welcome.enabled).toBe(true);
  });

  it('parseSessionOpsDocument rejects a corrupt document', () => {
    expect(() => parseSessionOpsDocument('[]')).toThrow(SessionOpsValidationError);
    expect(() => parseSessionOpsDocument(JSON.stringify({ sessions: [{ platform: 'icqq', sceneId: 'g1' }] }))).toThrow(SessionOpsValidationError);
    expect(parseSessionOpsDocument('').defaults).toEqual(BUILTIN_SESSION_OPS_DEFAULTS);
  });
});
