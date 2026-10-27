import { describe, expect, it, vi } from 'vitest';
import {
  AFFINITY_DAILY_GAIN_CAP,
  AFFINITY_GAIN_COOLDOWN_MS,
  AFFINITY_MAX,
  MAX_NOTES,
  hasSmallTalk,
  UserRelationStore,
  applyAffinitySignal,
  classifyAffinityCue,
  deriveRelation,
  emptyRelation,
  relationFromRow,
  relationToRow,
  sanitizeProfileText,
} from '../src/user-relation.js';
import { UserProfileStore } from '../src/user-profile.js';
import { ProfileContextBuilder } from '../src/context/default-builders.js';
import { countBusinessToolCalls, recordRelationTurn } from '../src/user-relation-turn.js';
import { createUserProfileTool } from '../src/tool/context-tools.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY } from '../src/context/turn-envelope.js';

const T0 = Date.parse('2026-10-27T02:00:00Z');
const signal = (text: string, extra: Partial<Parameters<typeof applyAffinitySignal>[1]> = {}) => ({
  addressed: true, isMaster: false, text, toolCalls: 0, ...extra,
});

describe('affinity rules', () => {
  it('classifies praise, insult, chat, tool-only, ambient and master', () => {
    expect(classifyAffinityCue(signal('谢谢你'))).toBe('praise');
    expect(classifyAffinityCue(signal('谢谢 傻逼'))).toBe('insult');
    expect(classifyAffinityCue(signal('今天好热'))).toBe('chat');
    expect(classifyAffinityCue(signal('查天气', { toolCalls: 1 }))).toBe('tool_only');
    expect(classifyAffinityCue(signal('傻逼', { addressed: false }))).toBe('ambient');
    expect(classifyAffinityCue(signal('傻逼', { isMaster: true }))).toBe('master');
  });

  it('applies a cooldown and a daily cap to gains', () => {
    let record = emptyRelation('qq', 'u1', T0);
    record = applyAffinitySignal(record, signal('谢谢'), T0).record;
    expect(record.affinity).toBe(3);
    record = applyAffinitySignal(record, signal('谢谢'), T0 + 1000).record;
    expect(record.affinity).toBe(3);
    let now = T0;
    for (let i = 0; i < 10; i += 1) {
      now += AFFINITY_GAIN_COOLDOWN_MS;
      record = applyAffinitySignal(record, signal('谢谢'), now).record;
    }
    expect(record.affinity).toBe(AFFINITY_DAILY_GAIN_CAP);
    record = applyAffinitySignal(record, signal('谢谢'), now + 24 * 3600 * 1000).record;
    expect(record.affinity).toBe(AFFINITY_DAILY_GAIN_CAP + 3);
  });

  it('only starts docking points after a tool-only streak and resets on chat', () => {
    let record = { ...emptyRelation('qq', 'u1', T0), affinity: 10 };
    for (let i = 0; i < 2; i += 1) record = applyAffinitySignal(record, signal('查', { toolCalls: 1 }), T0 + i).record;
    expect(record.affinity).toBe(10);
    record = applyAffinitySignal(record, signal('查', { toolCalls: 1 }), T0 + 3).record;
    expect(record.affinity).toBe(9);
    record = applyAffinitySignal(record, signal('哈哈'), T0 + 4).record;
    expect(record.toolStreak).toBe(0);
  });

  it('keeps the master at the ceiling and ignores ambient noise', () => {
    const master = applyAffinitySignal(emptyRelation('qq', 'm', T0), signal('滚蛋', { isMaster: true }), T0).record;
    expect(master.affinity).toBe(100);
    const ambient = applyAffinitySignal({ ...emptyRelation('qq', 'u', T0), affinity: 5 }, signal('傻逼', { addressed: false }), T0).record;
    expect(ambient.affinity).toBe(5);
    expect(ambient.interactions).toBe(0);
  });

  it('caps daily losses and clamps to -100', () => {
    let record = emptyRelation('qq', 'u', T0);
    for (let i = 0; i < 10; i += 1) record = applyAffinitySignal(record, signal('傻逼'), T0 + i).record;
    expect(record.affinity).toBe(-20);
  });

  it('derives relation with override precedence', () => {
    expect(deriveRelation({ affinity: 0, interactions: 0, relationOverride: null })).toBe('stranger');
    expect(deriveRelation({ affinity: 12, interactions: 3, relationOverride: null })).toBe('acquaintance');
    expect(deriveRelation({ affinity: 35, interactions: 9, relationOverride: null })).toBe('familiar');
    expect(deriveRelation({ affinity: 70, interactions: 25, relationOverride: null })).toBe('close');
    expect(deriveRelation({ affinity: 70, interactions: 25, relationOverride: 'stranger' })).toBe('stranger');
    expect(deriveRelation({ affinity: 0, interactions: 0, relationOverride: null }, true)).toBe('close');
  });
});

describe('privacy', () => {
  it('rejects secrets and long numbers, trims and truncates', () => {
    expect(sanitizeProfileText('我的密码是 123', 60)).toBeNull();
    expect(sanitizeProfileText('token sk-abcdefghijk', 60)).toBeNull();
    expect(sanitizeProfileText('手机 13800138000', 60)).toBeNull();
    expect(sanitizeProfileText('  喜欢\n原神  ', 60)).toBe('喜欢 原神');
    expect(sanitizeProfileText('a'.repeat(80), 10)).toHaveLength(10);
  });
});

function fakeModel() {
  const rows: Record<string, any>[] = [];
  const matches = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    select: () => ({ where: async (where: Record<string, any>) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })) }),
    create: async (data: Record<string, any>) => { rows.push({ ...data }); return data; },
    update: (data: Record<string, any>) => ({
      where: async (where: Record<string, any>) => { for (const row of rows) if (matches(row, where)) Object.assign(row, data); },
    }),
  };
}

describe('UserRelationStore', () => {
  it('merges one person across scenes into a single database row', async () => {
    let now = T0;
    const store = new UserRelationStore(() => now);
    const model = fakeModel();
    store.upgradeToDatabase(model);
    await store.recordTurn({ platform: 'qq', userId: 'u1', displayName: '小明', scene: 'group:1', isMaster: false, addressed: true, text: '你好', toolCalls: 0 });
    now += AFFINITY_GAIN_COOLDOWN_MS;
    await store.recordTurn({ platform: 'qq', userId: 'u1', scene: 'group:2', isMaster: false, addressed: true, text: '谢谢', toolCalls: 0 });
    expect(model.rows).toHaveLength(1);
    const record = relationFromRow(model.rows[0]);
    expect(record.affinity).toBe(4);
    expect(record.interactions).toBe(2);
    expect(record.recentScenes).toEqual(['group:1', 'group:2']);
    expect(record.displayName).toBe('小明');
    expect(relationFromRow(relationToRow(record))).toEqual(record);
  });

  it('serializes concurrent writes for the same person', async () => {
    let now = T0;
    const store = new UserRelationStore(() => (now += AFFINITY_GAIN_COOLDOWN_MS));
    await Promise.all(Array.from({ length: 5 }, () => store.recordTurn({ platform: 'qq', userId: 'u', isMaster: false, addressed: true, text: 'hi', toolCalls: 0 })));
    expect((await store.get('qq', 'u'))?.interactions).toBe(5);
  });

  it('caps notes, rejects secrets and stores address and tone', async () => {
    const store = new UserRelationStore(() => T0);
    for (let i = 0; i < MAX_NOTES + 3; i += 1) await store.addNote('qq', 'u', `梗${i}`);
    expect(await store.addNote('qq', 'u', '验证码 1234')).toBe(false);
    await store.setPreferredAddress('qq', 'u', '明哥');
    await store.setToneHints('qq', 'u', ['损友', '少用敬语']);
    const record = await store.get('qq', 'u');
    expect(record?.notes).toHaveLength(MAX_NOTES);
    expect(record?.notes.at(-1)).toBe(`梗${MAX_NOTES + 2}`);
    expect(await store.removeNote('qq', 'u', `梗${MAX_NOTES + 2}`)).toBe(true);
    const reloaded = await store.get('qq', 'u');
    expect(reloaded?.notes).not.toContain(`梗${MAX_NOTES + 2}`);
    expect(reloaded?.notes).toHaveLength(MAX_NOTES - 1);
    expect(reloaded?.preferredAddress).toBe('明哥');
    expect(record?.preferredAddress).toBe('明哥');
    expect(record?.toneHints).toEqual(['损友', '少用敬语']);
  });

  it('caps the summary to short lines with at most two notes', async () => {
    const store = new UserRelationStore(() => T0);
    for (let i = 0; i < 8; i += 1) await store.addNote('qq', 'u', `一条比较长的笔记内容第${i}条`.repeat(2));
    await store.setToneHints('qq', 'u', ['a', 'b', 'c', 'd']);
    const summary = store.buildSummary(await store.get('qq', 'u'));
    const [, sender] = summary.split('\n');
    expect(sender.length).toBeLessThanOrEqual(160);
    expect(sender).not.toContain('第0条');
    expect(sender).toContain('tone a/b');
  });

  it('builds a compact summary and skips first-time strangers', async () => {
    const store = new UserRelationStore(() => T0);
    const first = await store.recordTurn({ platform: 'qq', userId: 'u', isMaster: false, addressed: true, text: 'hi', toolCalls: 0 });
    expect(store.buildSummary(first)).toBe('');
    await store.setPreferredAddress('qq', 'u', '明哥');
    const summary = store.buildSummary(await store.get('qq', 'u'));
    expect(summary).toContain('[Relationship]');
    expect(summary).toContain('明哥: stranger');
    expect(summary).toContain('never quote');
    expect(summary.split('\n').length).toBeLessThanOrEqual(3);
  });
});

function imTurn(overrides: { roles?: string[]; scope?: 'private' | 'group'; ambient?: boolean; userId?: string; text?: string } = {}) {
  return {
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: overrides.scope ?? 'group', sceneId: 'g1', conversation: {} },
    principal: { subjectId: overrides.userId ?? 'u1', displayName: '小明', roles: overrides.roles ?? ['user'] },
    session: { key: 's' },
    input: { text: overrides.text ?? '在吗', ...(overrides.ambient ? { metadata: { [AMBIENT_ENGAGEMENT_METADATA_KEY]: 'ambient' } } : {}) },
  } as any;
}

describe('turn integration', () => {
  it('records turns asynchronously and injects sender plus recent actives on ambient turns', async () => {
    const profiles = new UserProfileStore(new UserRelationStore(() => T0));
    await profiles.relations.setPreferredAddress('qq', 'u2', '阿强');
    recordRelationTurn(profiles.relations, imTurn({ userId: 'u2' }), { toolCalls: [] });
    await profiles.relations.setPreferredAddress('qq', 'u1', '明哥');
    recordRelationTurn(profiles.relations, imTurn(), { toolCalls: [{ tool: 'load_skill' }] });
    await profiles.relations.get('qq', 'u1');

    const builder = new ProfileContextBuilder({ userProfiles: profiles } as any);
    const envelope: Record<string, string> = {};
    await builder.build({ turn: imTurn({ ambient: true }), envelope });
    expect(envelope.profileSummary).toContain('Sender: 明哥');
    expect(envelope.profileSummary).toContain('Also here: 阿强');
    expect(envelope.profileSummary).not.toContain('qq:u');

    const addressed: Record<string, string> = {};
    await builder.build({ turn: imTurn(), envelope: addressed });
    expect(addressed.profileSummary).not.toContain('Also here');
  });

  it('does not touch relations outside IM and swallows store errors', async () => {
    const recordTurn = vi.fn(async () => { throw new Error('db down'); });
    const failing = { recordTurn } as any;
    recordRelationTurn(failing, { ...imTurn(), origin: { kind: 'http', sessionId: 'x' } }, {});
    expect(recordTurn).not.toHaveBeenCalled();
    expect(() => recordRelationTurn(failing, imTurn(), {})).not.toThrow();
    expect(recordTurn).toHaveBeenCalledTimes(1);
    expect(countBusinessToolCalls([{ tool: 'user_profile' }, { tool: 'weather' }])).toBe(1);
  });

  it('user_profile tool exposes relation actions only with a platform', async () => {
    const profiles = new UserProfileStore(new UserRelationStore(() => T0));
    const legacy = createUserProfileTool('u1', profiles);
    expect((legacy.parameters as any).properties.action.enum).toEqual(['get', 'set', 'delete']);
    const tool = createUserProfileTool('u1', profiles, 'qq');
    expect(await tool.execute({ action: 'call_me', value: '明哥' })).toContain('明哥');
    expect((await profiles.relations.get('qq', 'u1'))?.preferredAddress).toBe('明哥');
    expect(await tool.execute({ action: 'note', value: '密码 hunter2' })).toContain('没记');
    expect(await tool.execute({ action: 'note', value: '夜猫子' })).toBe('已记下。');
    expect(await tool.execute({ action: 'get' })).toContain('夜猫子');
  });
});

describe('bounded growth', () => {
  it('tone hints dedupe and replace; notes roll over without duplicates', async () => {
    const store = new UserRelationStore(() => T0);
    await store.setToneHints('qq', 'u', ['损友', '损友', 'A', 'a', 'b', 'c', 'd']);
    expect((await store.get('qq', 'u'))?.toneHints).toEqual(['损友', 'A', 'b', 'c']);
    await store.setToneHints('qq', 'u', ['温柔']);
    expect((await store.get('qq', 'u'))?.toneHints).toEqual(['温柔']);
    for (let i = 0; i < 100; i += 1) await store.addNote('qq', 'u', `梗${i % 12}`);
    const notes = (await store.get('qq', 'u'))!.notes;
    expect(notes).toHaveLength(MAX_NOTES);
    expect(new Set(notes).size).toBe(MAX_NOTES);
  });
});

describe('review fixes', () => {
  const base = { addressed: true, isMaster: false, text: 'hi', toolCalls: 0 };

  it('master stays close even with a lower relation override', () => {
    const record = { ...emptyRelation('qq', 'm', T0), relationOverride: 'stranger' as const };
    expect(deriveRelation(record, true)).toBe('close');
    expect(deriveRelation(record, false)).toBe('stranger');
  });

  it('only charges the daily gain allowance and cooldown for points actually awarded', () => {
    const full = { ...emptyRelation('qq', 'u', T0), affinity: AFFINITY_MAX };
    const capped = applyAffinitySignal(full, { ...base, text: '谢谢' }, T0);
    expect(capped.delta).toBe(0);
    expect(capped.record.gainToday).toBe(0);
    expect(capped.record.lastGainAt).toBe(0);
    const near = applyAffinitySignal({ ...full, affinity: AFFINITY_MAX - 1 }, { ...base, text: '谢谢' }, T0);
    expect(near.delta).toBe(1);
    expect(near.record.gainToday).toBe(1);
  });

  it('tool turns with small talk count as chat, pure tool requests do not', () => {
    expect(classifyAffinityCue({ ...base, text: '查一下上海天气', toolCalls: 1 })).toBe('tool_only');
    expect(classifyAffinityCue({ ...base, text: '哈哈 顺便帮我查下天气', toolCalls: 1 })).toBe('chat');
    expect(hasSmallTalk('早上好呀，今天好冷')).toBe(true);
    expect(hasSmallTalk('翻译这句话')).toBe(false);
  });

  it('emits a close sender line for the owner on their very first turn', async () => {
    const profiles = new UserProfileStore(new UserRelationStore(() => T0));
    const builder = new ProfileContextBuilder({ userProfiles: profiles } as any);
    const envelope: Record<string, string> = {};
    await builder.build({ turn: imTurn({ roles: ['master'], userId: 'owner' }), envelope });
    expect(envelope.profileSummary).toContain('Sender: 小明: close (owner)');
  });

  it('treats observe intent as ambient and adds at most one recent active person', async () => {
    const profiles = new UserProfileStore(new UserRelationStore(() => T0));
    for (const id of ['u2', 'u3']) {
      await profiles.relations.setPreferredAddress('qq', id, `人${id}`);
      recordRelationTurn(profiles.relations, imTurn({ userId: id }), {});
    }
    await profiles.relations.setPreferredAddress('qq', 'u1', '明哥');
    await profiles.relations.get('qq', 'u3');
    const builder = new ProfileContextBuilder({ userProfiles: profiles } as any);
    const envelope: Record<string, string> = {};
    await builder.build({ turn: { ...imTurn(), intent: { kind: 'observe' } }, envelope });
    expect(envelope.profileSummary).toContain('Also here:');
    expect(envelope.profileSummary.match(/Also here:/g)).toHaveLength(1);
  });
});
