import { describe, expect, it } from 'vitest';
import {
  SUMMARY_MAX_CHARS,
  SessionProfileStore,
  emptySessionProfile,
  foldConversationEvent,
  foldInboundSender,
  sceneRoleOf,
  sessionProfileFromRow,
  sessionProfileToRow,
  speakBlock,
} from '../src/session-profile.js';
import { SessionContextBuilder } from '../src/context/default-builders.js';
import { UserProfileStore } from '../src/user-profile.js';
import { UserRelationStore } from '../src/user-relation.js';
import { createSessionProfileTool } from '../src/tool/context-tools.js';

const T0 = Date.parse('2026-10-27T02:00:00Z');
const SELF = new Set(['bot']);

describe('session profile folding', () => {
  it('tracks the bot mute window, whole-scene mute and the bot role', () => {
    let record = emptySessionProfile('qq', 'group', 'g1', T0);
    record = foldConversationEvent(record, { type: 'member.muted', member: { id: 'bot' }, durationSeconds: 600, timestamp: T0 }, SELF, T0);
    expect(speakBlock(record, T0 + 1000)).toBe('muted');
    expect(speakBlock(record, T0 + 601_000)).toBeNull();
    record = foldConversationEvent(record, { type: 'member.unmuted', member: { id: 'bot' } }, SELF, T0);
    expect(speakBlock(record, T0)).toBeNull();

    record = foldConversationEvent(record, { type: 'member.muted', member: { id: '0' }, durationSeconds: 0, timestamp: T0 }, SELF, T0);
    expect(speakBlock(record, T0)).toBe('muted_all');
    record = foldConversationEvent(record, { type: 'member.role_changed', member: { id: 'bot' }, role: 'admin', enabled: true }, SELF, T0);
    expect(speakBlock(record, T0)).toBeNull();
    record = foldConversationEvent(record, { type: 'member.unmuted', member: { id: '0' } }, SELF, T0);
    expect(record.mutedAll).toBe(false);
  });

  it('ignores other members being muted and tracks admins, joins and leaves', () => {
    let record = emptySessionProfile('qq', 'group', 'g1', T0);
    record = foldConversationEvent(record, { type: 'member.muted', member: { id: 'u1' }, durationSeconds: 600, timestamp: T0 }, SELF, T0);
    expect(speakBlock(record, T0)).toBeNull();
    record = foldConversationEvent(record, { type: 'member.role_changed', member: { id: 'u2', displayName: '阿强' }, role: 'admin', enabled: true }, SELF, T0);
    record = foldConversationEvent(record, { type: 'member.joined', member: { id: 'u3' } }, SELF, T0);
    record = foldConversationEvent(record, { type: 'member.left', member: { id: 'u2' } }, SELF, T0);
    expect(record.admins).toEqual([]);
    expect([record.joinedCount, record.leftCount]).toEqual([1, 1]);
  });

  it('learns scene owners and admins from sender roles and throttles speaker refreshes', () => {
    expect(sceneRoleOf(['owner'])).toBe('owner');
    expect(sceneRoleOf(['scene_admin'])).toBe('admin');
    expect(sceneRoleOf(['user'])).toBeUndefined();
    let record = emptySessionProfile('qq', 'group', 'g1', T0);
    record = foldInboundSender(record, { id: 'u1', name: '群主', sceneRole: 'owner' }, T0);
    const again = foldInboundSender(record, { id: 'u1' }, T0 + 1000);
    expect(again.recentSpeakers).toEqual(record.recentSpeakers);
    expect(record.admins[0]).toMatchObject({ name: '群主', role: 'owner' });
  });

  it('honours manual restrictions until they expire', () => {
    const record = { ...emptySessionProfile('qq', 'channel', 'c1', T0), restriction: 'readonly_channel', restrictionUntil: T0 + 10 };
    expect(speakBlock(record, T0)).toBe('restricted:readonly_channel');
    expect(speakBlock(record, T0 + 11)).toBeNull();
    expect(speakBlock({ ...record, restrictionUntil: 0 }, T0 + 1e9)).toBe('restricted:readonly_channel');
  });

  it('round-trips database rows', () => {
    const record = foldInboundSender(emptySessionProfile('qq', 'group', 'g1', T0), { id: 'u', name: 'n', sceneRole: 'admin' }, T0);
    expect(sessionProfileFromRow(sessionProfileToRow({ ...record, topics: ['原神'], mutedAll: true }))).toEqual({ ...record, topics: ['原神'], mutedAll: true });
  });
});

function fakeModel() {
  const rows: Record<string, any>[] = [];
  let writes = 0;
  const matches = (row: Record<string, any>, where: Record<string, any>) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    get writes() { return writes; },
    select: () => ({ where: async (where: Record<string, any>) => rows.filter((row) => matches(row, where)).map((row) => ({ ...row })) }),
    create: async (data: Record<string, any>) => { writes += 1; rows.push({ ...data }); return data; },
    update: (data: Record<string, any>) => ({
      where: async (where: Record<string, any>) => { writes += 1; for (const row of rows) if (matches(row, where)) Object.assign(row, data); },
    }),
  };
}

describe('SessionProfileStore', () => {
  it('folds pending conversation events on inbound and blocks speaking while muted', async () => {
    let now = T0;
    const store = new SessionProfileStore(() => now);
    const model = fakeModel();
    store.upgradeToDatabase(model);
    const events = [
      { sequence: 1, event: { type: 'message.created' } },
      { sequence: 2, event: { type: 'member.muted', member: { id: 'bot' }, durationSeconds: 60, timestamp: T0 } },
    ];
    const source = { listBetween: async (after: number, through: number) => events.filter((e) => e.sequence > after && e.sequence <= through) };
    const first = await store.observeInbound({ platform: 'qq', scope: 'group', sceneId: 'g1', sender: { id: 'u1' }, selfIds: ['bot'], throughSequence: 3, events: source });
    expect(first.blocked).toBe('muted');
    now += 61_000;
    const later = await store.observeInbound({ platform: 'qq', scope: 'group', sceneId: 'g1', sender: { id: 'u1' }, selfIds: ['bot'], throughSequence: 4, events: source });
    expect(later.blocked).toBeNull();
    expect(model.rows).toHaveLength(1);
  });

  it('does not write when nothing changed', async () => {
    const store = new SessionProfileStore(() => T0);
    const model = fakeModel();
    store.upgradeToDatabase(model);
    await store.observeInbound({ platform: 'qq', scope: 'group', sceneId: 'g1', sender: { id: 'u1' } });
    const writes = model.writes;
    await store.observeInbound({ platform: 'qq', scope: 'group', sceneId: 'g1', sender: { id: 'u1' } });
    expect(model.writes).toBe(writes);
  });

  it('keeps private sessions free of member data and skips their summary', async () => {
    const store = new SessionProfileStore(() => T0);
    const { profile } = await store.observeInbound({ platform: 'qq', scope: 'private', sceneId: 'u1', sender: { id: 'u1', sceneRole: 'owner' } });
    expect(profile?.recentSpeakers).toEqual([]);
    expect(store.buildSummary(profile)).toBe('');
    await store.setRestriction('qq', 'private', 'u1', 'blocked_by_user');
    expect((await store.observeInbound({ platform: 'qq', scope: 'private', sceneId: 'u1' })).blocked).toBe('restricted:blocked_by_user');
  });

  it('caps topics and renders a single short [Session] line', async () => {
    const store = new SessionProfileStore(() => T0);
    const saved = await store.setTopics('qq', 'group', 'g1', ['原神', '原神', '周末团建', '新番', '显卡', '考研', '跑步', '密码是 1234']);
    expect(saved).toEqual(['原神', '周末团建', '新番', '显卡', '考研']);
    for (const id of ['a', 'b', 'c', 'd']) {
      await store.observeInbound({ platform: 'qq', scope: 'group', sceneId: 'g1', title: '摸鱼群', sender: { id, name: `管理员${id}`, sceneRole: 'admin' } });
    }
    const summary = store.buildSummary(await store.get('qq', 'group', 'g1'));
    expect(summary.split('\n')).toHaveLength(1);
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(summary).toContain('topics: 原神; 周末团建; 新番');
    expect(summary).not.toContain('显卡');
  });
});

describe('session context and tool', () => {
  const turn = (scope: 'group' | 'private') => ({
    origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope, sceneId: scope === 'group' ? 'g1' : 'u1', conversation: {} },
    principal: { subjectId: 'u1', roles: ['user'] },
    session: { key: 's' },
  }) as any;

  it('injects [Session] only for multi-person sessions', async () => {
    const profiles = new UserProfileStore(new UserRelationStore(() => T0), new SessionProfileStore(() => T0));
    await profiles.sessions.setTopics('qq', 'group', 'g1', ['原神']);
    const builder = new SessionContextBuilder({ userProfiles: profiles } as any);
    const group: Record<string, string> = {};
    await builder.build({ turn: turn('group'), envelope: group });
    expect(group.sessionSummary).toContain('[Session] group');
    const dm: Record<string, string> = {};
    await builder.build({ turn: turn('private'), envelope: dm });
    expect(dm.sessionSummary).toBeUndefined();
  });

  it('session_profile tool updates and reads topics', async () => {
    const profiles = new UserProfileStore(new UserRelationStore(() => T0), new SessionProfileStore(() => T0));
    const tool = createSessionProfileTool(profiles, { platform: 'qq', scope: 'group', sceneId: 'g1' });
    expect(await tool.execute({ action: 'topics', value: '原神，周末团建' })).toContain('原神; 周末团建');
    expect(await tool.execute({ action: 'get' })).toContain('topics: 原神; 周末团建');
  });
});

describe('ephemeral injection', () => {
  it('never persists [Relationship] or [Session] into stored conversation history', async () => {
    const { createUserMessage, serializeAgentMessage } = await import('@zhin.js/ai');
    const { buildTurnContextBlocks } = await import('../src/context/turn-envelope.js');
    const { appendTurnContextBlocks } = await import('../src/context/turn-user-message.js');
    const actor = { scope: 'group', subjectId: 'u1', displayName: '小明', roles: ['user'] } as any;
    for (const [agentsContext, withActor] of [[undefined, false], ['workspace rules', false], [undefined, true], ['workspace rules', true]] as const) {
      const blocks = buildTurnContextBlocks({
        profileSummary: '[Relationship] (data)\n- Sender: 明哥: familiar',
        sessionSummary: '[Session] group (data): topics: 原神',
        ...(agentsContext ? { agentsContext } : {}),
      });
      const user = withActor ? { ...createUserMessage('你好'), actor } : createUserMessage('你好');
      const [prompt] = appendTurnContextBlocks([user], blocks, {} as any);
      expect(JSON.stringify(prompt)).toContain('[Relationship]');
      const row = serializeAgentMessage(prompt!);
      expect(row.payload).not.toContain('[Relationship]');
      expect(row.payload).not.toContain('[Session]');
      expect(row.payload).toContain('你好');
    }
  });
});
