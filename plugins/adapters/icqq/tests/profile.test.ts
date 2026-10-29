import { describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { OutboundMessageService } from '@zhin.js/core/runtime';
import {
  ADAPTER_ACTION_NAMES,
  assertDeclaredProfileActions,
  declaredProfileActions,
  defineAdapter,
  resolveTurnCapabilities,
} from 'zhin.js/adapter';
import type { Client, MemberInfo } from '@icqqjs/icqq';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import definition from '../adapters/icqq/index.js';
import { IcqqEndpoint } from '../src/endpoint.js';
import { createIcqqActionPorts } from '../src/group-actions.js';
import { resolveIcqqConfig } from '../src/protocol.js';
import { createIcqqTestPorts } from './_icqq-mock.js';

const profile = definition.profile!;
const endpointRef = { id: 'icqq', adapter: 'icqq' };
const conversation = (kind: 'private' | 'group' | 'channel') =>
  ({ endpoint: endpointRef, kind, id: '100' }) as const;
const resolve = (kind: 'private' | 'group' | 'channel', platformRole?: string) =>
  resolveTurnCapabilities({
    profile,
    conversation: conversation(kind),
    facts: platformRole ? { bot: { platformRole } } : {},
    ...(definition.resolveCapabilities ? { narrow: definition.resolveCapabilities } : {}),
  });

describe('icqq capability profile', () => {
  it('is a valid profile and declares all 14 actions in some section', () => {
    expect(() => defineAdapter({ ...definition, segments: undefined, create: () => ({ send: async () => 'id' }) as never })).not.toThrow();
    expect([...declaredProfileActions(profile)].sort()).toEqual([...ADAPTER_ACTION_NAMES].sort());
  });

  it('keeps the segment policy on the definition alias', () => {
    expect(definition.segments?.outboundMedia).toEqual(['base64', 'url', 'path']);
    expect(definition.segments?.reaction?.values.length).toBeGreaterThan(10);
  });

  it('finds every declared port on a real endpoint (assembly check)', () => {
    const gateway: OutboundMessageService = { receive: vi.fn(), send: vi.fn(async () => 'sent') };
    const endpoint = bindTestEndpoint(new IcqqEndpoint({
      id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq'),
      gateway,
      config: resolveIcqqConfig({ id: '10001', autoReconnect: false }),
      ...createIcqqTestPorts(),
    }), gateway, undefined);
    expect(() => assertDeclaredProfileActions(endpoint, profile, 'icqq', true)).not.toThrow();
  });

  it('group, bot is admin: management actions on, owner-only title off', () => {
    const caps = resolve('group', 'admin');
    for (const action of ['mute', 'unmute', 'muteAll', 'kick', 'setCard', 'essence', 'announce', 'invite', 'poke', 'reaction', 'recall']) {
      expect(caps.has(`actions.${action}`), action).toBe(true);
    }
    expect(caps.has('actions.setTitle')).toBe(false);
    expect(caps.get('actions.mute.durationSeconds')).toEqual({ min: 60, max: 2592000 });
    expect(caps.get('actions.recall.timeLimitSeconds')).toBe(120);
  });

  it('group, bot is owner: title works too', () => {
    expect(resolve('group', 'owner').has('actions.setTitle')).toBe(true);
  });

  it('group, bot is a plain member: management actions off, social actions stay', () => {
    const caps = resolve('group', 'member');
    for (const action of ['mute', 'unmute', 'muteAll', 'kick', 'setCard', 'setTitle', 'essence', 'announce']) {
      expect(caps.has(`actions.${action}`), action).toBe(false);
    }
    for (const action of ['poke', 'reaction', 'recall', 'invite', 'quoteReply', 'forward']) {
      expect(caps.has(`actions.${action}`), action).toBe(true);
    }
  });

  it('group, role unknown fails closed for role-gated actions', () => {
    const caps = resolve('group');
    expect(caps.has('actions.mute')).toBe(false);
    expect(caps.has('actions.poke')).toBe(true);
  });

  it('group, whole-group mute drops sending', () => {
    const caps = resolveTurnCapabilities({
      profile,
      conversation: conversation('group'),
      facts: { bot: { platformRole: 'member' }, conversation: { muteAll: true } },
    });
    expect(caps.has('delivery.send')).toBe(false);
  });

  it('private: poke and recall only, no group management, no reactions', () => {
    const caps = resolve('private');
    expect(caps.has('actions.poke')).toBe(true);
    expect(caps.has('actions.recall')).toBe(true);
    expect(caps.has('actions.quoteReply')).toBe(true);
    for (const action of ['reaction', 'mute', 'kick', 'setCard', 'essence', 'announce', 'invite']) {
      expect(caps.has(`actions.${action}`), action).toBe(false);
    }
    expect(caps.get('feedback.mode')).toBe('status-message');
    expect(caps.has('scene.groupInfo')).toBe(false);
  });

  it('group declares reaction feedback, events and scene facts', () => {
    const caps = resolve('group', 'admin');
    expect(caps.get('feedback.mode')).toBe('reaction');
    expect(caps.get<string[]>('events.emit')).toContain('member.joined');
    expect(caps.get('scene.groupInfo')).toBe(true);
    expect(caps.get('scene.memberProfile')).toBe(true);
    expect(caps.get('scene.title')).toBe(true);
    expect(caps.get('delivery.spool')).toBe(true);
    expect((caps.get<string>('prompt.text') ?? '').length).toBeLessThanOrEqual(600);
  });

  it('guild channel: send only', () => {
    const caps = resolve('channel');
    expect(caps.has('delivery.send')).toBe(true);
    for (const action of ['recall', 'poke', 'forward', 'reaction', 'mute']) {
      expect(caps.has(`actions.${action}`), action).toBe(false);
    }
  });
});

function fakeClient(selfRole: MemberInfo['role'], targetRole: MemberInfo['role'] | null = 'member') {
  const native = {
    uin: 10001,
    getGroupMemberInfo: vi.fn(async (group: number, user: number) => {
      if (user === 10001) return { user_id: 10001, group_id: group, role: selfRole };
      if (targetRole === null) throw new Error('not in group');
      return { user_id: user, group_id: group, role: targetRole };
    }),
    setGroupBan: vi.fn(async () => true),
    setGroupWholeBan: vi.fn(async () => true),
    setGroupCard: vi.fn(async () => true),
    setGroupSpecialTitle: vi.fn(async () => true),
    setEssenceMessage: vi.fn(async () => 'ok'),
    removeEssenceMessage: vi.fn(async () => 'ok'),
    inviteFriend: vi.fn(async () => true),
    sendGroupPoke: vi.fn(async () => true),
    pickFriend: vi.fn(() => ({ poke: vi.fn(async () => true) })),
  };
  return { native, ports: createIcqqActionPorts(() => native as unknown as Client) };
}

describe('icqq action ports', () => {
  it('pokes in a group and privately', async () => {
    const f = fakeClient('member');
    await f.ports.pokeUser!('20', '100');
    expect(f.native.sendGroupPoke).toHaveBeenCalledWith(100, 20);
    await f.ports.pokeUser!('20');
    expect(f.native.pickFriend).toHaveBeenCalledWith(20);
  });

  it('unmute and muteAll read the bot role fresh and refuse a plain member', async () => {
    const admin = fakeClient('admin');
    await admin.ports.unmuteGroupMember!('100', '20');
    expect(admin.native.setGroupBan).toHaveBeenCalledWith(100, 20, 0);
    await admin.ports.muteAllGroupMembers!('100', true);
    expect(admin.native.setGroupWholeBan).toHaveBeenCalledWith(100, true);
    expect(admin.native.getGroupMemberInfo).toHaveBeenCalledWith(100, 10001, true);

    const member = fakeClient('member');
    await expect(member.ports.unmuteGroupMember!('100', '20')).rejects.toThrow('not a group admin');
    await expect(member.ports.muteAllGroupMembers!('100', true)).rejects.toThrow('not a group admin');
    expect(member.native.setGroupBan).not.toHaveBeenCalled();
  });

  it('setGroupCard: anyone may rename itself, others need admin', async () => {
    const member = fakeClient('member');
    await member.ports.setGroupCard!('100', '10001', 'bot');
    expect(member.native.setGroupCard).toHaveBeenCalledWith(100, 10001, 'bot');
    await expect(member.ports.setGroupCard!('100', '20', 'x')).rejects.toThrow('not a group admin');
    const admin = fakeClient('admin');
    await admin.ports.setGroupCard!('100', '20', 'x');
    expect(admin.native.setGroupCard).toHaveBeenCalledWith(100, 20, 'x');
  });

  it('setGroupTitle needs the owner and a present target; omitted duration is permanent', async () => {
    const owner = fakeClient('owner');
    await owner.ports.setGroupTitle!('100', '20', 'boss');
    expect(owner.native.setGroupSpecialTitle).toHaveBeenCalledWith(100, 20, 'boss', -1);
    await owner.ports.setGroupTitle!('100', '20', 'boss', 3600);
    expect(owner.native.setGroupSpecialTitle).toHaveBeenLastCalledWith(100, 20, 'boss', 3600);
    await expect(fakeClient('admin').ports.setGroupTitle!('100', '20', 'x')).rejects.toThrow('owner');
    await expect(fakeClient('owner', null).ports.setGroupTitle!('100', '20', 'x')).rejects.toThrow('not a group member');
  });

  it('essence sets or clears, admin only', async () => {
    const admin = fakeClient('admin');
    await admin.ports.setGroupEssence!('100', 'm1', true);
    await admin.ports.setGroupEssence!('100', 'm1', false);
    expect(admin.native.setEssenceMessage).toHaveBeenCalledWith('m1');
    expect(admin.native.removeEssenceMessage).toHaveBeenCalledWith('m1');
    await expect(fakeClient('member').ports.setGroupEssence!('100', 'm1', true)).rejects.toThrow('not a group admin');
  });

  it('invite refuses someone already in the group and surfaces an unconfirmed result', async () => {
    await expect(fakeClient('member', 'member').ports.inviteGroupMember!('100', '20')).rejects.toThrow('already');
    const f = fakeClient('member', null);
    await f.ports.inviteGroupMember!('100', '20');
    expect(f.native.inviteFriend).toHaveBeenCalledWith(100, 20);
    f.native.inviteFriend.mockResolvedValue(false);
    await expect(f.ports.inviteGroupMember!('100', '20')).rejects.toThrow('did not confirm');
  });

  it('rejects malformed ids before any platform call', async () => {
    const f = fakeClient('admin');
    await expect(f.ports.pokeUser!('abc', '100')).rejects.toThrow('Invalid QQ identifier');
    expect(f.native.sendGroupPoke).not.toHaveBeenCalled();
  });
});
