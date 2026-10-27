import { runRouletteCommand } from '../src/roulette-command.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeClock,
  createFakeMessage,
  runCommand,
  runMiddleware,
  runPluginSetup,
  type FakeMessage,
  type FakePlugin,
} from '@zhin.js/testing';
import { adapterFeatureId } from 'zhin.js/adapter';
import plugin from '../plugin.ts';
import deadlineSchedule from '../schedules/deadlines/index.ts';
import rouletteCommand from '../commands/roulette/[[action]]/index.ts';
import aliasMiddleware from '../middlewares/roulette-alias/index.ts';
import fireMiddleware from '../middlewares/roulette-fire/index.ts';
import type { RouletteConfig } from '../src/config.js';
import { decodeRouletteState, type RouletteState } from '../src/engine.js';
import { rouletteServicesToken } from '../src/runtime.js';
import { RouletteGroupSettings } from '../src/session-service.js';

const bulletChamber = vi.hoisted(() => ({ next: 5 }));

// The cylinder is spun with game-kit's secure random; pin it so every round is reproducible.
vi.mock('@zhin.js/game-kit', async (importOriginal) => ({
  ...await importOriginal<typeof import('@zhin.js/game-kit')>(),
  secureRandomInt: () => bulletChamber.next,
}));

type RouletteFake = FakePlugin<Partial<RouletteConfig>>;

const config: Partial<RouletteConfig> = {
  chambers: 6,
  turnTimeoutSeconds: 30,
  lobbyTimeoutSeconds: 120,
  muteSeconds: 90,
};

let clock: FakeClock;
let fake: RouletteFake;

interface MuteCall {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly groupId: string;
  readonly userId: string;
  readonly durationSeconds: number;
}

/**
 * Stands in for the Adapter Feature projection (`AdapterIndex`). Only
 * `connection()` matters to the game: a capable Endpoint exposes
 * `management.muteGroupMember`, an incapable one has no management port.
 */
const adapters = {
  canMute: false,
  refuseNextMute: false,
  muteCalls: [] as MuteCall[],
  lookups: [] as string[],
  connection(adapter: string, endpointKey: string): unknown {
    this.lookups.push(`${adapter} ${endpointKey}`);
    if (!this.canMute) return { name: endpointKey };
    return {
      name: endpointKey,
      management: {
        muteGroupMember: async (groupId: string, userId: string, durationSeconds: number) => {
          if (this.refuseNextMute) {
            this.refuseNextMute = false;
            throw new Error('permission denied');
          }
          this.muteCalls.push({ adapter, endpointKey, groupId, userId, durationSeconds });
        },
      },
    };
  },
};

function resetAdapters(): void {
  adapters.canMute = false;
  adapters.refuseNextMute = false;
  adapters.muteCalls = [];
  adapters.lookups = [];
}

/** Plugin setup plus the convention `schedules/deadlines` job, run by the fake cron with a capability context. */
async function setUpRoulette(options: { readonly schedule?: boolean; readonly adapterFeature?: boolean } = {}): Promise<RouletteFake> {
  const projections = options.adapterFeature === false
    ? new Map()
    : new Map([[adapterFeatureId, adapters]]);
  const created = await runPluginSetup(plugin, {
    clock,
    config,
    projections,
    ...(options.schedule === false ? { hosts: { schedule: false } } : {}),
  });
  if (options.schedule !== false) {
    created.scheduleHost.register({
      id: 'roulette/deadlines',
      cron: deadlineSchedule.cron,
      execute: () => deadlineSchedule.execute(created.capabilityContext()),
    });
  }
  return created;
}

function message(
  senderId: string,
  options: { readonly group?: string; readonly roles?: readonly string[]; readonly kind?: 'group' | 'private' } = {},
): FakeMessage {
  return createFakeMessage({
    sender: { id: senderId, name: senderId.toUpperCase(), roles: options.roles ?? [] },
    conversation: { kind: options.kind ?? 'group', id: options.group ?? 'g1' },
  });
}

async function say(
  senderId: string,
  action: string,
  options?: Parameters<typeof message>[1],
): Promise<string> {
  const reply = await runCommand(fake, rouletteCommand, {
    input: message(senderId, options),
    params: { action },
  });
  return String(reply);
}

/** The newest game in a group; Alice sits at every table these tests create. */
async function activeState(group = 'g1'): Promise<RouletteState | undefined> {
  const services = fake.resources.use(rouletteServicesToken);
  const latest = await services.sessions.getLatestForUser(`test-default-group:${group}`, 'alice');
  return latest ? decodeRouletteState(latest.state_json) : undefined;
}

async function seatThreeAndStart(group = 'g1'): Promise<void> {
  await say('alice', '开局', { group });
  await say('bob', '加入', { group });
  await say('carol', '加入', { group });
  await say('alice', '开始', { group });
}

/** Whoever is on turn fires until the bullet comes; returns every reply. */
async function playUntilShot(group = 'g1'): Promise<string[]> {
  const replies: string[] = [];
  for (let pull = 0; pull < 6; pull += 1) {
    const state = await activeState(group);
    if (!state || state.phase !== 'playing') break;
    const shooter = state.players[state.turnIndex]!;
    replies.push(await say(shooter.id, '开枪', { group }));
  }
  return replies;
}

function muteCalls(): readonly MuteCall[] {
  return adapters.muteCalls;
}

function sentTexts(): readonly string[] {
  return fake.sent
    .filter((call) => call.kind === 'send')
    .map((call) => String((call.input as { content: unknown }).content));
}

beforeEach(async () => {
  bulletChamber.next = 5;
  clock = new FakeClock(Date.UTC(2026, 9, 20, 4, 0, 0));
  // Plugins read wall time through Date.now(); keep it on the fake clock.
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now());
  resetAdapters();
  fake = await setUpRoulette();
});

afterEach(async () => {
  await fake.dispose();
  vi.restoreAllMocks();
});

describe('roulette gameplay', () => {
  it('registers as a game-hub game with a five-second deadline schedule', () => {
    expect(fake.features.find((feature) => feature.kind === 'game')?.localName).toBe('roulette');
    expect(deadlineSchedule.cron).toBe('*/5 * * * * *');
  });

  it('plays a full round: lobby, turns in join order, one loser, records for the leaderboard', async () => {
    expect(await say('alice', '开局')).toContain('等待玩家（1/6）');
    expect(await say('bob', '加入')).toContain('ALICE、BOB');
    expect(await say('carol', '加入')).toContain('ALICE、BOB、CAROL');
    expect(await say('bob', '开始')).toBe('只有开局的人可以开始。');
    expect(await say('alice', '开始')).toContain('👉 轮到 ALICE');

    const replies = await playUntilShot();
    const final = await activeState();

    expect(final).toMatchObject({ phase: 'finished', loserId: 'carol', pullsMade: 6 });
    expect(replies).toHaveLength(6);
    expect(replies.at(-1)).toContain('💥 砰！CAROL 中弹出局（第 6 枪）');
    expect(replies.slice(0, -1).every((reply) => reply.includes('空膛'))).toBe(true);
    const records = fake.rows('game_records');
    expect(records).toHaveLength(3);
    const loserRecord = records.find((record) => record.user_id === final?.loserId);
    expect(loserRecord).toMatchObject({ result: 'lost', score: 0, game_id: 'roulette' });
    expect(records.filter((record) => record.result === 'won')).toHaveLength(2);
  });

  it('the first player can lose on the first pull when the bullet is in chamber one', async () => {
    bulletChamber.next = 0;
    await seatThreeAndStart();

    expect(await say('alice', '开枪')).toContain('💥 砰！ALICE 中弹出局（第 1 枪）');
    expect(await say('bob', '开枪')).toBe('本群没有进行中的轮盘。');
  });

  it('refuses out-of-turn shots and keeps the turn with the right player', async () => {
    await seatThreeAndStart();

    expect(await say('bob', '开枪')).toBe('还没轮到你，现在轮到 ALICE。');
    expect((await activeState())?.pullsMade).toBe(0);
  });

  it('a player cannot sit at two tables in the same group, and private chats are refused', async () => {
    await say('alice', '开局');

    expect(await say('bob', '开局')).toContain('本群已经有一局轮盘了');
    expect(await say('alice', '开局', { kind: 'private' })).toContain('请在群聊里玩');
  });

  it('cancelling needs the host or a bot manager and records nothing', async () => {
    await seatThreeAndStart();

    expect(await say('bob', '取消')).toBe('只有开局的人、群主、群管理员或机器人管理员可以取消本局。');
    expect(await say('dave', '取消', { roles: ['master'] })).toContain('已取消');
    expect(fake.rows('game_records')).toHaveLength(0);
  });

  it.each([['owner'], ['admin']])('lets the platform group %s cancel the game', async (role) => {
    await seatThreeAndStart();

    expect(await say('bob', '取消', { roles: ['member'] })).toBe('只有开局的人、群主、群管理员或机器人管理员可以取消本局。');
    expect(await say('dave', '取消', { roles: [role] })).toContain('已取消');
  });

  it('leaving a running round is a forfeit', async () => {
    await seatThreeAndStart();

    expect(await say('carol', '退出')).toContain('🏳️ CAROL 中途离场，判负');
    expect((await activeState())?.loserId).toBe('carol');
  });
});

describe('mute penalty', () => {
  it('is off by default: the loser is only scored', async () => {
    adapters.canMute = true;
    await seatThreeAndStart();
    await playUntilShot();

    expect(muteCalls()).toEqual([]);
    expect(await say('bob', '禁言')).toContain('本群禁言惩罚：关闭。当前平台支持禁言。');
  });

  it('only a bot manager may switch it, and a platform without muting refuses to enable it', async () => {
    expect(await say('bob', '开启禁言')).toBe('只有群主、群管理员、机器人主人或受信任用户可以修改禁言惩罚。');
    expect(await say('bob', '开启禁言', { roles: ['member'] })).toBe('只有群主、群管理员、机器人主人或受信任用户可以修改禁言惩罚。');
    expect(await say('owner', '开启禁言', { roles: ['master'] })).toContain('当前平台不支持禁言');
    expect(await say('carol', '开启禁言', { roles: ['admin'] })).toContain('当前平台不支持禁言');
    expect(await say('dave', '开启禁言', { roles: ['owner'] })).toContain('当前平台不支持禁言');
    expect(await say('bob', '禁言')).toContain('本群禁言惩罚：关闭。当前平台不支持禁言');
  });

  it('mutes the loser where the Endpoint can mute and the group opted in, and nowhere else', async () => {
    adapters.canMute = true;
    expect(await say('owner', '开启禁言', { roles: ['trusted'] })).toContain('禁言 90 秒');

    await seatThreeAndStart('g1');
    const replies = await playUntilShot('g1');
    const loserId = (await activeState('g1'))?.loserId;

    expect(replies.at(-1)).toContain(`🔇 ${loserId?.toUpperCase()} 被禁言 90 秒`);
    expect(muteCalls()).toEqual([{
      adapter: 'test',
      endpointKey: 'test',
      groupId: 'g1',
      userId: loserId,
      durationSeconds: 90,
    }]);

    await seatThreeAndStart('g2');
    await playUntilShot('g2');
    expect(muteCalls()).toHaveLength(1);
  });

  it('falls back to scoring when the platform stops supporting mute after it was enabled', async () => {
    adapters.canMute = true;
    await say('owner', '开启禁言', { roles: ['master'] });
    adapters.canMute = false;

    await seatThreeAndStart();
    const replies = await playUntilShot();

    expect(replies.at(-1)).toContain('当前平台无法禁言，本局只计分');
    expect(muteCalls()).toEqual([]);
    expect(fake.rows('game_records')).toHaveLength(3);
  });

  it('a mute the platform refuses (bot is not an admin) still ends the round with scores', async () => {
    adapters.canMute = true;
    await say('owner', '开启禁言', { roles: ['master'] });
    await seatThreeAndStart();
    for (const shooter of ['alice', 'bob', 'carol', 'alice', 'bob']) await say(shooter, '开枪');

    adapters.refuseNextMute = true;
    const lastShot = await say('carol', '开枪');

    expect(lastShot).toContain('禁言没有成功，可能是机器人没有群管理权限；本局只计分');
    expect(fake.rows('game_records')).toHaveLength(3);
  });

  it('looks the Endpoint up by the exact conversation endpoint, never by platform name', async () => {
    await say('bob', '禁言');

    expect(adapters.lookups).toEqual(['test test']);
  });

  it('a runtime without the Adapter Feature projection is score-only', async () => {
    await fake.dispose();
    fake = await setUpRoulette({ adapterFeature: false });

    expect(await say('owner', '开启禁言', { roles: ['master'] })).toContain('当前平台不支持禁言');
    await seatThreeAndStart();
    await playUntilShot();
    expect(fake.rows('game_records')).toHaveLength(3);
  });

  it('turning it off stops muting', async () => {
    adapters.canMute = true;
    await say('owner', '开启禁言', { roles: ['master'] });
    expect(await say('owner', '关闭禁言', { roles: ['master'] })).toContain('已关闭');

    await seatThreeAndStart();
    await playUntilShot();
    expect(muteCalls()).toEqual([]);
  });
});

describe('timeouts (FakeClock)', () => {
  it('the player on turn loses when they do not fire in time, and the group is told', async () => {
    adapters.canMute = true;
    await say('owner', '开启禁言', { roles: ['master'] });
    await seatThreeAndStart();
    expect(await say('alice', '开枪')).toContain('👉 轮到 BOB');

    await clock.advance(29_000);
    expect((await activeState())?.phase).toBe('playing');

    await clock.advance(5_000);
    const timedOut = await activeState();
    expect(timedOut).toMatchObject({ phase: 'finished', endReason: 'turn-timeout', loserId: 'bob' });
    expect(sentTexts().at(-1)).toContain('⌛ BOB 超时没有开枪，判负');
    expect(muteCalls()).toEqual([expect.objectContaining({ userId: 'bob', durationSeconds: 90 })]);
    expect(fake.rows('game_records').find((record) => record.user_id === 'bob')?.result).toBe('lost');
  });

  it('a failing penalty-setting read leaves the session active, still announces the others, and retries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await seatThreeAndStart('g1');
    await seatThreeAndStart('g2');
    const real = RouletteGroupSettings.prototype.isMutePenaltyEnabled;
    const read = vi.spyOn(RouletteGroupSettings.prototype, 'isMutePenaltyEnabled')
      .mockImplementation(async function (this: RouletteGroupSettings, key: string) {
        if (key.endsWith(':g1')) throw new Error('db down');
        return real.call(this, key);
      });
    const sentBefore = sentTexts().length;

    await clock.advance(35_000);

    expect((await activeState('g1'))?.phase).toBe('playing');
    expect((await activeState('g2'))?.phase).toBe('finished');
    expect(sentTexts().length - sentBefore).toBe(1);
    expect(fake.rows('game_records')).toHaveLength(3);

    read.mockImplementation(real);
    await clock.advance(5_000);

    expect([(await activeState('g1'))?.phase, (await activeState('g2'))?.phase]).toEqual(['finished', 'finished']);
    expect(sentTexts().length - sentBefore).toBe(2);
    expect(fake.rows('game_records')).toHaveLength(6);
  });

  it('each shot restarts the turn timer', async () => {
    await seatThreeAndStart();
    await clock.advance(20_000);
    await say('alice', '开枪');

    await clock.advance(20_000);
    expect((await activeState())?.phase).toBe('playing');
  });

  it('a lobby that never starts is dissolved without records', async () => {
    await say('alice', '开局');
    await say('bob', '加入');

    await clock.advance(125_000);

    expect(await activeState()).toMatchObject({ phase: 'aborted', endReason: 'lobby-expired' });
    expect(sentTexts().at(-1)).toContain('长时间没有开始，已自动解散');
    expect(fake.rows('game_records')).toHaveLength(0);
  });

  it('without a schedule host the timeout is applied on the next message', async () => {
    await fake.dispose();
    fake = await setUpRoulette({ schedule: false });
    await seatThreeAndStart();

    clock.set(clock.now() + 31_000);
    const reply = await say('bob', '状态');

    expect(reply).toContain('⌛ ALICE 超时没有开枪，判负');
    expect(reply).toContain('本群没有进行中的轮盘');
  });
});

describe('chat entry points', () => {
  it('the 轮盘 alias runs actions and lets unknown words through', async () => {
    const open = await runMiddleware(fake, aliasMiddleware, createFakeMessage({
      content: '轮盘 开局',
      sender: { id: 'alice', name: 'ALICE', roles: [] },
      conversation: { kind: 'group', id: 'g1' },
    }));
    const chat = await runMiddleware(fake, aliasMiddleware, createFakeMessage({ content: '轮盘 好玩吗' }));

    expect(open.continued).toBe(false);
    expect((await activeState())?.phase).toBe('lobby');
    expect(chat.continued).toBe(true);
  });

  it('a bare 开枪 fires only for the player on turn', async () => {
    await seatThreeAndStart();
    const fromBob = await runMiddleware(fake, fireMiddleware, { ...message('bob'), content: '开枪' });
    const aliceMessage = { ...message('alice'), content: '开枪' };
    const fromAlice = await runMiddleware(fake, fireMiddleware, aliceMessage);

    expect(fromBob.continued).toBe(true);
    expect(fromAlice.continued).toBe(false);
    expect(aliceMessage.replies).toHaveLength(1);
    expect((await activeState())?.pullsMade).toBe(1);
  });
});


it('pins roulette rules and deadline notices to the opening player language', async () => {
  const enContext = { ...fake.capabilityContext(), locale: 'en' as const, formatCommand: (path: string) => path === 'roulette' ? '!!party roulette' : undefined };
  const opened = await runRouletteCommand(enContext, message('alice'), 'open');
  expect(String(opened)).toContain('!!party roulette join');
  expect(String(opened)).not.toMatch(/[\u4e00-\u9fff]/);
  const zhContext = { ...fake.capabilityContext(), locale: 'zh-CN' as const };
  expect(String(await runRouletteCommand(zhContext, message('bob'), 'join'))).not.toMatch(/[\u4e00-\u9fff]/);
  await runRouletteCommand(zhContext, message('alice'), 'start');
  expect(String(await runRouletteCommand(zhContext, message('bob'), 'fire'))).toContain('ALICE');
  expect(String(await runRouletteCommand(zhContext, message('bob'), 'fire'))).not.toMatch(/[\u4e00-\u9fff]/);
  await clock.advance(35_000);
  expect(sentTexts().at(-1)).toContain('ALICE');
  expect(sentTexts().at(-1)).not.toMatch(/[\u4e00-\u9fff]/);
  expect(fake.sent.at(-1)?.input).toMatchObject({ locale: 'en' });
});
