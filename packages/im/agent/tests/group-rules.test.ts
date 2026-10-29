import { describe, expect, it } from 'vitest';
import {
  AI_GROUP_RULE_MODEL,
  AiGroupRules,
  DEFAULT_GROUP_RULE_APPROVAL_TTL_MS,
  DEFAULT_GROUP_RULE_RETENTION_DAYS,
  DEFAULT_GROUP_RULE_WINDOW_MS,
  GroupRuleHashMismatchError,
  GroupRuleRevisionConflictError,
  GroupRuleStateError,
  GroupRuleUnavailableError,
  GroupRuleValidationError,
  MAX_OPEN_GROUP_RULES_PER_SCENE,
  MAX_TERMINAL_GROUP_RULES_PER_SCENE,
  groupRuleContentHash,
  groupRuleFromRow,
  groupRuleHashShort,
  normalizeGroupRuleSpec,
  type GroupRuleModel,
} from '../src/group-rules.js';
import type { DecisionEventInput } from '../src/decision-events.js';

const DAY = 24 * 60 * 60 * 1000;

function harness(options: { ttl?: number } = {}) {
  let now = 1_000_000;
  const events: DecisionEventInput[] = [];
  const store = new AiGroupRules({
    now: () => now,
    ...(options.ttl ? { approvalTtlMs: options.ttl } : {}),
    audit: () => ({ record: (input) => { events.push(input); } }),
  });
  return { store, events, advance: (ms: number) => { now += ms; }, now: () => now };
}

const spec = {
  trigger: 'advertising',
  ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 600 }],
  content: '发广告的先提醒，再犯禁言十分钟',
};
const base = { platform: 'icqq', sceneId: 'group:123', createdBy: 'owner-1', createdVia: 'im' as const, ...spec };

function memoryModel() {
  const rows: Record<string, unknown>[] = [];
  let failReads = false;
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const model: GroupRuleModel = {
    select: () => ({
      where: async (where) => {
        if (failReads) throw new Error('db down');
        return rows.filter((row) => matches(row, where)).map((row) => ({ ...row }));
      },
    }),
    create: async (row) => { rows.push({ ...row }); },
    update: (row) => ({
      where: async (where) => {
        for (const item of rows) if (matches(item, where)) Object.assign(item, row);
      },
    }),
    delete: () => ({
      where: async (where) => {
        for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i]!, where)) rows.splice(i, 1);
      },
    }),
  };
  return { model, rows, failReads: (value: boolean) => { failReads = value; } };
}

async function activeRule(store: AiGroupRules, overrides: Partial<typeof base> = {}) {
  const drafted = await store.create({ ...base, ...overrides });
  await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
  return store.approve({ id: drafted.record.id, expectedRevision: 2, actorId: 'admin-1', approvedVia: 'im' });
}

describe('ai_group_rules schema', () => {
  it('has the ADR 0039 §1 columns (trigger stored as rule_trigger)', () => {
    for (const column of ['id', 'platform', 'scene_id', 'rule_trigger', 'ladder', 'window_ms', 'exempt', 'content', 'content_hash',
      'status', 'created_by', 'created_via', 'approved_by', 'approved_at', 'approved_via', 'revision']) {
      expect(AI_GROUP_RULE_MODEL).toHaveProperty(column);
    }
    expect(AI_GROUP_RULE_MODEL).not.toHaveProperty('trigger');
    expect(AI_GROUP_RULE_MODEL.id).toMatchObject({ type: 'text', primary: true });
    expect(DEFAULT_GROUP_RULE_APPROVAL_TTL_MS).toBe(DAY);
    expect(DEFAULT_GROUP_RULE_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});

describe('normalizeGroupRuleSpec / content hash', () => {
  it('fills defaults and strips durations from non-mute stages', () => {
    const normalized = normalizeGroupRuleSpec({ ...spec, ladder: [{ action: 'warn', durationSec: 99 }, { action: 'mute', durationSec: 60 }] });
    expect(normalized.ladder).toEqual([{ action: 'warn' }, { action: 'mute', durationSec: 60 }]);
    expect(normalized.windowMs).toBe(DEFAULT_GROUP_RULE_WINDOW_MS);
    expect(normalized.exempt).toEqual({ ownerAndAdmins: true, userIds: [] });
  });

  it.each([
    [{ trigger: 'spam' }, /trigger/],
    [{ ladder: [] }, /ladder/],
    [{ ladder: Array.from({ length: 6 }, () => ({ action: 'remind' })) }, /ladder/],
    [{ ladder: [{ action: 'kick' }] }, /action/],
    [{ ladder: [{ action: 'mute', durationSec: 59 }] }, /durationSec/],
    [{ ladder: [{ action: 'mute', durationSec: 86_401 }] }, /durationSec/],
    [{ ladder: [{ action: 'mute' }] }, /durationSec/],
    [{ windowMs: 1000 }, /windowMs/],
    [{ content: '  ' }, /content/],
    [{ content: 'x'.repeat(501) }, /content/],
    [{ exempt: { userIds: Array.from({ length: 101 }, (_, i) => `u${i}`) } }, /userIds/],
  ])('rejects out-of-range input %#', (patch, message) => {
    expect(() => normalizeGroupRuleSpec({ ...spec, ...patch } as never)).toThrow(GroupRuleValidationError);
    expect(() => normalizeGroupRuleSpec({ ...spec, ...patch } as never)).toThrow(message);
  });

  it('is stable for equivalent input and changes when any field changes', () => {
    const scope = { platform: 'icqq', sceneId: 'group:123' };
    const a = groupRuleContentHash(scope, normalizeGroupRuleSpec({ ...spec, exempt: { userIds: ['b', 'a', 'a'] } }));
    const b = groupRuleContentHash(scope, normalizeGroupRuleSpec({ ...spec, exempt: { userIds: ['a', 'b'] } }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(groupRuleHashShort(a)).toBe(a.slice(0, 8));
    const variants = [
      { ...spec, content: `${spec.content}。` },
      { ...spec, ladder: [{ action: 'remind' }, { action: 'mute', durationSec: 601 }] },
      { ...spec, windowMs: DEFAULT_GROUP_RULE_WINDOW_MS + 1000 },
      { ...spec, trigger: 'abuse' },
      { ...spec, exempt: { ownerAndAdmins: false } },
    ];
    for (const variant of variants) {
      expect(groupRuleContentHash(scope, normalizeGroupRuleSpec(variant))).not.toBe(groupRuleContentHash(scope, normalizeGroupRuleSpec(spec)));
    }
    expect(groupRuleContentHash({ ...scope, sceneId: 'group:456' }, normalizeGroupRuleSpec(spec)))
      .not.toBe(groupRuleContentHash(scope, normalizeGroupRuleSpec(spec)));
  });
});

describe('AiGroupRules state machine', () => {
  it('drafts → submits → approves and audits each step as group_rule', async () => {
    const { store, events } = harness();
    const drafted = await store.create(base);
    expect(drafted.record).toMatchObject({ status: 'draft', revision: 1, trigger: 'advertising', createdVia: 'im' });
    const approved = await activeRuleFrom(store, drafted.record.id);
    expect(approved.record).toMatchObject({ status: 'active', approvedBy: 'admin-1', approvedVia: 'im', revision: 3 });
    expect(events.map((event) => [event.kind, event.reasonCode, event.outcome])).toEqual([
      ['group_rule', 'rule_drafted', 'allow'],
      ['group_rule', 'rule_submitted', 'defer'],
      ['group_rule', 'rule_approved', 'allow'],
    ]);
    expect(events[2]).toMatchObject({ platform: 'icqq', sceneId: 'group:123', actorId: 'admin-1', payload: { ruleId: drafted.record.id, from: 'pending', to: 'active', approvedVia: 'im' } });
    expect(await store.getActive({ platform: 'icqq', sceneId: 'group:123', trigger: 'advertising' })).toMatchObject({ id: drafted.record.id });
  });

  it('records model drafts with actor=model and only accepts group scenes', async () => {
    const { store, events } = harness();
    await store.create({ ...base, createdVia: 'model' });
    expect(events[0]).toMatchObject({ actor: 'model', actorId: 'owner-1' });
    await expect(store.create({ ...base, sceneId: 'private:1' })).rejects.toThrow(GroupRuleValidationError);
    await expect(store.create({ ...base, createdVia: 'cli' as never })).rejects.toThrow(GroupRuleValidationError);
  });

  it('editing a pending rule returns it to draft with a new hash', async () => {
    const { store } = harness();
    const drafted = await store.create(base);
    await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
    const edited = await store.edit({ id: drafted.record.id, expectedRevision: 2, actorId: 'owner-1', spec: { ...spec, content: '改了一个字' } });
    expect(edited.record.status).toBe('draft');
    expect(edited.record.contentHash).not.toBe(drafted.record.contentHash);
    expect(edited.record.submittedAt).toBeNull();
  });

  it('rejects approval when the card hash no longer matches and audits rule_hash_mismatch', async () => {
    const { store, events } = harness();
    const drafted = await store.create(base);
    await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
    await expect(store.approve({ id: drafted.record.id, expectedRevision: 2, actorId: 'admin-1', approvedVia: 'im', contentHash: 'stale' }))
      .rejects.toThrow(GroupRuleHashMismatchError);
    expect(events.at(-1)).toMatchObject({ reasonCode: 'rule_hash_mismatch', outcome: 'deny' });
    expect((await store.get(drafted.record.id))?.status).toBe('pending');
    const ok = await store.approve({ id: drafted.record.id, expectedRevision: 2, actorId: 'admin-1', approvedVia: 'console', contentHash: drafted.record.contentHash });
    expect(ok.record.status).toBe('active');
  });

  it('keeps at most one active rule per trigger: approving a new one supersedes the old', async () => {
    const { store, events } = harness();
    const first = await activeRule(store);
    const abuse = await activeRule(store, { trigger: 'abuse' });
    const second = await activeRule(store, { content: '更严：直接禁言', ladder: [{ action: 'mute', durationSec: 600 }] });
    expect(second.superseded?.map((rule) => rule.id)).toEqual([first.record.id]);
    const old = await store.get(first.record.id);
    expect(old).toMatchObject({ status: 'disabled', content: '' });
    expect(events.some((event) => event.reasonCode === 'rule_superseded' && event.turnId === second.turnId)).toBe(true);
    expect((await store.get(abuse.record.id))?.status).toBe('active');
    expect((await store.getActive({ platform: 'icqq', sceneId: 'group:123', trigger: 'advertising' }))?.id).toBe(second.record.id);
  });

  it('cannot edit an active rule; disabling needs no approval and clears the summary', async () => {
    const { store } = harness();
    const active = await activeRule(store);
    await expect(store.edit({ id: active.record.id, expectedRevision: 3, actorId: 'owner-1', spec })).rejects.toThrow(GroupRuleStateError);
    const disabled = await store.disable({ id: active.record.id, expectedRevision: 3, actorId: 'admin-2', reason: '不需要了' });
    expect(disabled.record).toMatchObject({ status: 'disabled', content: '', reason: '不需要了' });
    await expect(store.disable({ id: active.record.id, expectedRevision: 4, actorId: 'admin-2' })).rejects.toThrow(GroupRuleStateError);
  });

  it('rejects pending rules into a terminal state', async () => {
    const { store, events } = harness();
    const drafted = await store.create(base);
    await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
    const rejected = await store.reject({ id: drafted.record.id, expectedRevision: 2, actorId: 'admin-1', reason: 'x'.repeat(500) });
    expect(rejected.record.status).toBe('rejected');
    expect(rejected.record.content).toBe('');
    expect(Array.from(rejected.record.reason ?? '')).toHaveLength(200);
    expect(events.at(-1)).toMatchObject({ reasonCode: 'rule_rejected', outcome: 'deny' });
    await expect(store.approve({ id: drafted.record.id, expectedRevision: 3, actorId: 'admin-1', approvedVia: 'im' })).rejects.toThrow(GroupRuleStateError);
  });

  it('expires pending rules after the approval TTL, and refuses late approvals', async () => {
    const { store, events, advance } = harness();
    const drafted = await store.create(base);
    await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
    advance(DEFAULT_GROUP_RULE_APPROVAL_TTL_MS);
    await expect(store.approve({ id: drafted.record.id, expectedRevision: 2, actorId: 'admin-1', approvedVia: 'im' })).rejects.toThrow(GroupRuleStateError);
    expect(await store.get(drafted.record.id)).toMatchObject({ status: 'expired', content: '' });
    expect(events.at(-1)).toMatchObject({ reasonCode: 'rule_expired', actor: 'policy' });
  });

  it('enforces optimistic revisions', async () => {
    const { store } = harness();
    const drafted = await store.create(base);
    await expect(store.submit({ id: drafted.record.id, expectedRevision: 7, actorId: 'owner-1' })).rejects.toThrow(GroupRuleRevisionConflictError);
  });

  it('caps open (draft + pending) rules per group', async () => {
    const { store } = harness();
    for (let i = 0; i < MAX_OPEN_GROUP_RULES_PER_SCENE; i += 1) await store.create({ ...base, content: `r${i}` });
    await expect(store.create(base)).rejects.toThrow(/at most/);
    await expect(store.create({ ...base, sceneId: 'group:456' })).resolves.toBeTruthy();
  });

  it('survives audit sink failures', async () => {
    const store = new AiGroupRules({ audit: () => ({ record: () => { throw new Error('audit down'); } }) });
    await expect(store.create(base)).resolves.toBeTruthy();
  });
});

describe('AiGroupRules prune (bounded disk)', () => {
  it('deletes terminal rows past retention and keeps live ones', async () => {
    const { store, advance } = harness();
    const { model, rows } = memoryModel();
    await store.upgradeToDatabase(model);
    const disabled = await store.create(base);
    await store.disable({ id: disabled.record.id, expectedRevision: 1, actorId: 'owner-1' });
    const active = await activeRule(store);
    const draft = await store.create({ ...base, content: 'draft' });
    advance(DEFAULT_GROUP_RULE_RETENTION_DAYS * DAY - 1);
    expect((await store.prune()).deleted).toBe(0);
    advance(2);
    expect((await store.prune()).deleted).toBe(1);
    expect(rows.map((row) => row.id).sort()).toEqual([active.record.id, draft.record.id].sort());
  });

  it('expires stale pending rules during prune, then removes them once past retention', async () => {
    const { store, advance } = harness();
    const drafted = await store.create(base);
    await store.submit({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
    advance(DEFAULT_GROUP_RULE_APPROVAL_TTL_MS);
    await store.prune();
    expect((await store.get(drafted.record.id))?.status).toBe('expired');
    advance(DEFAULT_GROUP_RULE_RETENTION_DAYS * DAY + 1);
    await store.prune();
    expect(await store.get(drafted.record.id)).toBeNull();
  });

  it('keeps at most MAX_TERMINAL_GROUP_RULES_PER_SCENE terminal rows per group, dropping the oldest', async () => {
    const { store, advance } = harness();
    const ids: string[] = [];
    for (let i = 0; i < MAX_TERMINAL_GROUP_RULES_PER_SCENE + 3; i += 1) {
      const drafted = await store.create({ ...base, content: `r${i}` });
      await store.disable({ id: drafted.record.id, expectedRevision: 1, actorId: 'owner-1' });
      ids.push(drafted.record.id);
      advance(1000);
    }
    expect((await store.prune()).deleted).toBe(3);
    for (const id of ids.slice(0, 3)) expect(await store.get(id)).toBeNull();
    expect(await store.get(ids[3]!)).not.toBeNull();
  });

  it('rejects invalid retention and surfaces storage errors', async () => {
    const { store } = harness();
    await expect(store.prune(0)).rejects.toThrow(TypeError);
    const { model, failReads } = memoryModel();
    await store.upgradeToDatabase(model);
    failReads(true);
    await expect(store.prune()).rejects.toThrow(GroupRuleUnavailableError);
  });
});

describe('persistence', () => {
  it('round-trips through the table and reads unknown status as disabled', async () => {
    const { store } = harness();
    const { model, rows } = memoryModel();
    await store.upgradeToDatabase(model);
    const active = await activeRule(store);
    expect(rows[0]).toMatchObject({ rule_trigger: 'advertising', status: 'active', ladder: JSON.stringify(active.record.ladder) });
    expect(await store.get(active.record.id)).toEqual(active.record);
    expect(groupRuleFromRow({ ...rows[0], status: 'weird' }).status).toBe('disabled');
  });
});

async function activeRuleFrom(store: AiGroupRules, id: string) {
  await store.submit({ id, expectedRevision: 1, actorId: 'owner-1' });
  return store.approve({ id, expectedRevision: 2, actorId: 'admin-1', approvedVia: 'im' });
}

describe('AiGroupRules transition listeners (slice B)', () => {
  const scene = { platform: 'icqq', sceneId: 'group:1' };
  const spec = { trigger: 'abuse', ladder: [{ action: 'warn' }], content: 'x' };

  it('notifies listeners after each transition, passes the endpoint hint, and swallows listener errors', async () => {
    const store = new AiGroupRules();
    const seen: string[] = [];
    store.onTransition(() => { throw new Error('boom'); });
    const stop = store.onTransition((t) => seen.push(`${t.reasonCode}:${t.endpoint ?? '-'}`));
    const created = await store.create({ ...scene, ...spec, createdBy: 'u', createdVia: 'console' });
    const submitted = await store.submit({ id: created.record.id, expectedRevision: 1, actorId: 'u', endpoint: 'bot-1' });
    await store.approve({ id: created.record.id, expectedRevision: submitted.record.revision, actorId: 'u', approvedVia: 'im' });
    stop();
    const other = await store.create({ ...scene, ...spec, createdBy: 'u', createdVia: 'console' });
    expect(other.record.status).toBe('draft');
    expect(seen).toEqual(['rule_drafted:-', 'rule_submitted:bot-1', 'rule_approved:-']);
  });

  it('records a forbidden draft without writing a rule', async () => {
    const events: Array<Record<string, unknown>> = [];
    const store = new AiGroupRules({ audit: () => ({ record: (input) => { events.push(input as never); } }) });
    store.recordDraftForbidden({ ...scene, actorId: 'u-2', turnId: 't' });
    expect(await store.list(scene)).toHaveLength(0);
    expect(events).toEqual([expect.objectContaining({ kind: 'group_rule', outcome: 'deny', reasonCode: 'rule_draft_forbidden', actorId: 'u-2', turnId: 't' })]);
  });
});
