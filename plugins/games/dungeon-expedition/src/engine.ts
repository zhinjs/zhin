import { DeterministicRandom } from '@zhin.js/game-kit';

export const DUNGEON_SCHEMA_VERSION = 1;
export const MAX_PARTY_SIZE = 4;
export const MAX_FLOOR = 3;
export const BOSS_ROOM = 4;

export type DungeonPhase = 'lobby' | 'exploring' | 'combat' | 'completed';
export type DungeonResult = 'victory' | 'defeat' | 'aborted' | null;

export interface DungeonPlayer {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  readonly hp: number;
  readonly guard: number;
  readonly potions: number;
  readonly gold: number;
  readonly ready: boolean;
}

export interface DungeonEnemy {
  readonly id: string;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly boss: boolean;
}

export interface DungeonState {
  readonly schemaVersion: 1;
  readonly ownerId: string;
  readonly phase: DungeonPhase;
  readonly result: DungeonResult;
  readonly floor: number;
  readonly room: number;
  readonly roomsCleared: number;
  readonly turnIndex: number;
  readonly players: readonly DungeonPlayer[];
  readonly enemy: DungeonEnemy | null;
  readonly log: readonly string[];
}

export type DungeonAction =
  | { readonly type: 'join'; readonly name: string }
  | { readonly type: 'ready' }
  | { readonly type: 'start' }
  | { readonly type: 'explore' }
  | { readonly type: 'attack' }
  | { readonly type: 'defend' }
  | { readonly type: 'potion' }
  | { readonly type: 'abort' };

export class DungeonRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DungeonRuleError';
  }
}

export function createDungeonState(
  ownerId: string,
  ownerName: string,
): DungeonState {
  return {
    schemaVersion: DUNGEON_SCHEMA_VERSION,
    ownerId,
    phase: 'lobby',
    result: null,
    floor: 1,
    room: 0,
    roomsCleared: 0,
    turnIndex: 0,
    players: [createPlayer(ownerId, ownerName, true)],
    enemy: null,
    log: [`${ownerName} 创建了远征队。`],
  };
}

export function applyDungeonAction(
  state: Readonly<DungeonState>,
  actorId: string,
  action: DungeonAction,
  random: DeterministicRandom,
): DungeonState {
  if (state.phase === 'completed') {
    throw new DungeonRuleError('本次远征已经结束。');
  }
  if (action.type === 'join') return joinParty(state, actorId, action.name);
  const actorIndex = state.players.findIndex((player) => player.id === actorId);
  if (actorIndex < 0) throw new DungeonRuleError('你还没有加入这支远征队。');
  if (action.type === 'abort') {
    if (state.ownerId !== actorId) {
      throw new DungeonRuleError('只有队长可以结束整支远征。');
    }
    return appendLog({
      ...state,
      phase: 'completed',
      result: 'aborted',
      enemy: null,
    }, '队长结束了本次远征。');
  }
  if (action.type === 'ready') {
    if (state.phase !== 'lobby') {
      throw new DungeonRuleError('远征已经开始，无法修改准备状态。');
    }
    const players = state.players.map((player, index) =>
      index === actorIndex ? { ...player, ready: !player.ready } : player);
    return appendLog(
      { ...state, players },
      `${players[actorIndex]?.name ?? actorId}${players[actorIndex]?.ready ? '已准备' : '取消准备'}。`,
    );
  }
  if (action.type === 'start') return startExpedition(state, actorId);
  assertActorTurn(state, actorId);
  if (action.type === 'explore') return explore(state, random);
  if (action.type === 'attack') return attack(state, actorIndex, random);
  if (action.type === 'defend') return defend(state, actorIndex, random);
  return drinkPotion(state, actorIndex, random);
}

export function activePlayer(state: Readonly<DungeonState>): DungeonPlayer | null {
  if (state.players.length === 0) return null;
  return state.players[state.turnIndex % state.players.length] ?? null;
}

export function decodeDungeonState(raw: string): DungeonState {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new TypeError('Invalid dungeon state');
  }
  const candidate = parsed as Partial<DungeonState>;
  if (candidate.schemaVersion !== DUNGEON_SCHEMA_VERSION
    || !Array.isArray(candidate.players)
    || typeof candidate.ownerId !== 'string') {
    throw new TypeError('Unsupported dungeon state schema');
  }
  return candidate as DungeonState;
}

function createPlayer(id: string, name: string, ready: boolean): DungeonPlayer {
  return {
    id,
    name: name.trim() || id,
    maxHp: 100,
    hp: 100,
    guard: 0,
    potions: 2,
    gold: 0,
    ready,
  };
}

function joinParty(
  state: Readonly<DungeonState>,
  actorId: string,
  actorName: string,
): DungeonState {
  if (state.phase !== 'lobby') {
    throw new DungeonRuleError('远征已经出发，无法中途加入。');
  }
  if (state.players.some((player) => player.id === actorId)) {
    throw new DungeonRuleError('你已经在远征队中。');
  }
  if (state.players.length >= MAX_PARTY_SIZE) {
    throw new DungeonRuleError('远征队已满，最多 4 人。');
  }
  const player = createPlayer(actorId, actorName, false);
  return appendLog(
    { ...state, players: [...state.players, player] },
    `${player.name} 加入了远征队。`,
  );
}

function startExpedition(
  state: Readonly<DungeonState>,
  actorId: string,
): DungeonState {
  if (state.phase !== 'lobby') {
    throw new DungeonRuleError('远征已经开始。');
  }
  if (state.ownerId !== actorId) {
    throw new DungeonRuleError('只有队长可以带队出发。');
  }
  const waiting = state.players.filter((player) => !player.ready);
  if (waiting.length > 0) {
    throw new DungeonRuleError(
      `仍有队员未准备：${waiting.map((player) => player.name).join('、')}`,
    );
  }
  return appendLog({ ...state, phase: 'exploring' }, '远征队进入了第一层地牢。');
}

function assertActorTurn(state: Readonly<DungeonState>, actorId: string): void {
  if (state.phase === 'lobby') {
    throw new DungeonRuleError('请先由队长开始远征。');
  }
  const current = activePlayer(state);
  if (!current || current.id !== actorId) {
    throw new DungeonRuleError(`现在轮到 ${current?.name ?? '其他队员'} 行动。`);
  }
}

function explore(
  state: Readonly<DungeonState>,
  random: DeterministicRandom,
): DungeonState {
  if (state.phase !== 'exploring') {
    throw new DungeonRuleError('战斗尚未结束，无法继续探索。');
  }
  const room = state.room + 1;
  if (room >= BOSS_ROOM) {
    const enemy = createEnemy(state.floor, true, random);
    return appendLog(
      { ...state, room, phase: 'combat', enemy },
      `守层者 ${enemy.name} 挡住了去路！`,
    );
  }
  const roll = random.int(100);
  if (roll < 58) {
    const enemy = createEnemy(state.floor, false, random);
    return appendLog(
      { ...state, room, phase: 'combat', enemy },
      `遭遇了 ${enemy.name}！`,
    );
  }
  if (roll < 78) {
    const gold = random.intInclusive(8, 18);
    return advanceAfterRoom(
      {
        ...state,
        room,
        players: state.players.map((player) => ({
          ...player,
          gold: player.gold + gold,
        })),
      },
      `发现宝箱，每位队员获得 ${gold} 金币。`,
    );
  }
  if (roll < 90) {
    return advanceAfterRoom(
      {
        ...state,
        room,
        players: state.players.map((player) => ({
          ...player,
          hp: Math.min(player.maxHp, player.hp + 18),
        })),
      },
      '发现治愈泉，队伍恢复了生命。',
    );
  }
  const damage = random.intInclusive(8, 16);
  const targetIndex = nextLivingIndex(state.players, state.turnIndex);
  const target = state.players[targetIndex];
  const players = state.players.map((player, index) =>
    index === targetIndex
      ? { ...player, hp: Math.max(0, player.hp - damage) }
      : player);
  const trapped = advanceAfterRoom(
    { ...state, room, players },
    `${target?.name ?? '队员'} 触发陷阱，受到 ${damage} 点伤害。`,
  );
  const resolved = finishIfDefeated(trapped);
  if (resolved.phase === 'completed' || (players[targetIndex]?.hp ?? 0) > 0) {
    return resolved;
  }
  return advanceTurn(resolved);
}

function attack(
  state: Readonly<DungeonState>,
  actorIndex: number,
  random: DeterministicRandom,
): DungeonState {
  if (state.phase !== 'combat' || !state.enemy) {
    throw new DungeonRuleError('当前没有可以攻击的敌人。');
  }
  const actor = state.players[actorIndex];
  if (!actor || actor.hp <= 0) throw new DungeonRuleError('倒下的队员无法行动。');
  const damage = random.intInclusive(12, 22);
  const enemy = { ...state.enemy, hp: Math.max(0, state.enemy.hp - damage) };
  let next = appendLog(
    { ...state, enemy },
    `${actor.name} 对 ${enemy.name} 造成 ${damage} 点伤害。`,
  );
  if (enemy.hp <= 0) return defeatEnemy(next, random);
  next = enemyTurn(next, actorIndex, random);
  return advanceTurn(finishIfDefeated(next));
}

function defend(
  state: Readonly<DungeonState>,
  actorIndex: number,
  random: DeterministicRandom,
): DungeonState {
  if (state.phase !== 'combat' || !state.enemy) {
    throw new DungeonRuleError('当前不需要防御。');
  }
  const actor = state.players[actorIndex];
  if (!actor || actor.hp <= 0) throw new DungeonRuleError('倒下的队员无法行动。');
  const players = state.players.map((player, index) =>
    index === actorIndex ? { ...player, guard: 8 } : player);
  let next = appendLog({ ...state, players }, `${actor.name} 架起了盾牌。`);
  next = enemyTurn(next, actorIndex, random);
  return advanceTurn(finishIfDefeated(next));
}

function drinkPotion(
  state: Readonly<DungeonState>,
  actorIndex: number,
  random: DeterministicRandom,
): DungeonState {
  const actor = state.players[actorIndex];
  if (!actor || actor.hp <= 0) throw new DungeonRuleError('倒下的队员无法行动。');
  if (actor.potions <= 0) throw new DungeonRuleError('你的药水已经用完了。');
  if (actor.hp >= actor.maxHp) throw new DungeonRuleError('你的生命值已经满了。');
  const players = state.players.map((player, index) =>
    index === actorIndex
      ? {
          ...player,
          hp: Math.min(player.maxHp, player.hp + 30),
          potions: player.potions - 1,
        }
      : player);
  let next = appendLog({ ...state, players }, `${actor.name} 使用药水恢复生命。`);
  if (state.phase === 'combat') {
    next = enemyTurn(next, actorIndex, random);
    return advanceTurn(finishIfDefeated(next));
  }
  return next;
}

function enemyTurn(
  state: Readonly<DungeonState>,
  targetIndex: number,
  random: DeterministicRandom,
): DungeonState {
  const enemy = state.enemy;
  const target = state.players[targetIndex];
  if (!enemy || !target) return state;
  const rawDamage = random.intInclusive(
    Math.max(1, enemy.attack - 3),
    enemy.attack + 3,
  );
  const damage = Math.max(0, rawDamage - target.guard);
  const players = state.players.map((player, index) =>
    index === targetIndex
      ? { ...player, hp: Math.max(0, player.hp - damage), guard: 0 }
      : player);
  return appendLog(
    { ...state, players },
    `${enemy.name} 反击 ${target.name}，造成 ${damage} 点伤害。`,
  );
}

function defeatEnemy(
  state: Readonly<DungeonState>,
  random: DeterministicRandom,
): DungeonState {
  const enemy = state.enemy;
  if (!enemy) return state;
  const gold = random.intInclusive(enemy.boss ? 30 : 10, enemy.boss ? 50 : 22);
  const rewarded = {
    ...state,
    enemy: null,
    players: state.players.map((player) => ({
      ...player,
      gold: player.gold + gold,
    })),
  };
  if (enemy.boss && state.floor >= MAX_FLOOR) {
    return appendLog({
      ...rewarded,
      phase: 'completed',
      result: 'victory',
      roomsCleared: state.roomsCleared + 1,
    }, `击败最终守层者，每人获得 ${gold} 金币。远征胜利！`);
  }
  if (enemy.boss) {
    return appendLog({
      ...rewarded,
      phase: 'exploring',
      floor: state.floor + 1,
      room: 0,
      roomsCleared: state.roomsCleared + 1,
    }, `击败守层者，每人获得 ${gold} 金币。队伍进入下一层。`);
  }
  return advanceAfterRoom(
    { ...rewarded, phase: 'exploring' },
    `击败 ${enemy.name}，每人获得 ${gold} 金币。`,
  );
}

function createEnemy(
  floor: number,
  boss: boolean,
  random: DeterministicRandom,
): DungeonEnemy {
  const names = boss
    ? ['石像守卫', '深渊术士', '远古龙影']
    : ['洞穴史莱姆', '骷髅巡卫', '暗影猎手', '失控魔像'];
  const name = boss
    ? names[Math.min(names.length - 1, floor - 1)] as string
    : random.item(names);
  const maxHp = boss
    ? 90 + floor * 45
    : random.intInclusive(35 + floor * 8, 52 + floor * 12);
  return {
    id: `${boss ? 'boss' : 'mob'}-${floor}-${random.nextUint32().toString(36)}`,
    name,
    hp: maxHp,
    maxHp,
    attack: boss ? 12 + floor * 3 : 7 + floor * 2,
    boss,
  };
}

function advanceAfterRoom(
  state: Readonly<DungeonState>,
  message: string,
): DungeonState {
  return appendLog({
    ...state,
    roomsCleared: state.roomsCleared + 1,
  }, message);
}

function advanceTurn(state: Readonly<DungeonState>): DungeonState {
  if (state.phase === 'completed') return state as DungeonState;
  const nextIndex = nextLivingIndex(state.players, state.turnIndex + 1);
  return { ...state, turnIndex: nextIndex };
}

function nextLivingIndex(
  players: readonly DungeonPlayer[],
  start: number,
): number {
  for (let offset = 0; offset < players.length; offset += 1) {
    const index = (start + offset) % players.length;
    if ((players[index]?.hp ?? 0) > 0) return index;
  }
  return 0;
}

function finishIfDefeated(state: Readonly<DungeonState>): DungeonState {
  if (state.players.some((player) => player.hp > 0)) return state as DungeonState;
  return appendLog({
    ...state,
    phase: 'completed',
    result: 'defeat',
    enemy: null,
  }, '远征队全员倒下，本次远征失败。');
}

function appendLog(
  state: Readonly<DungeonState>,
  message: string,
): DungeonState {
  return {
    ...state,
    log: [...state.log, message].slice(-8),
  } as DungeonState;
}
