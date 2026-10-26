import { createMessages, type Locale } from 'zhin.js/i18n';
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
  locale?: Locale,
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
    log: [messages(locale, 'text1', { p0: ownerName })],
  };
}

export function applyDungeonAction(
  state: Readonly<DungeonState>,
  actorId: string,
  action: DungeonAction,
  random: DeterministicRandom,
  locale?: Locale,
): DungeonState {
  if (state.phase === 'completed') {
    throw new DungeonRuleError(messages(locale, 'text2'));
  }
  if (action.type === 'join') return joinParty(state, actorId, action.name, locale);
  const actorIndex = state.players.findIndex((player) => player.id === actorId);
  if (actorIndex < 0) throw new DungeonRuleError(messages(locale, 'text3'));
  if (action.type === 'abort') {
    if (state.ownerId !== actorId) {
      throw new DungeonRuleError(messages(locale, 'text4'));
    }
    return appendLog({
      ...state,
      phase: 'completed',
      result: 'aborted',
      enemy: null,
    }, messages(locale, 'text5'));
  }
  if (action.type === 'ready') {
    if (state.phase !== 'lobby') {
      throw new DungeonRuleError(messages(locale, 'text6'));
    }
    const players = state.players.map((player, index) =>
      index === actorIndex ? { ...player, ready: !player.ready } : player);
    return appendLog(
      { ...state, players },
      `${players[actorIndex]?.name ?? actorId}${players[actorIndex]?.ready ? messages(locale, 'text7') : messages(locale, 'text8')}。`,
    );
  }
  if (action.type === 'start') return startExpedition(state, actorId, locale);
  assertActorTurn(state, actorId, locale);
  if (action.type === 'explore') return explore(state, random, locale);
  if (action.type === 'attack') return attack(state, actorIndex, random, locale);
  if (action.type === 'defend') return defend(state, actorIndex, random, locale);
  return drinkPotion(state, actorIndex, random, locale);
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
  locale?: Locale,
): DungeonState {
  if (state.phase !== 'lobby') {
    throw new DungeonRuleError(messages(locale, 'text9'));
  }
  if (state.players.some((player) => player.id === actorId)) {
    throw new DungeonRuleError(messages(locale, 'text10'));
  }
  if (state.players.length >= MAX_PARTY_SIZE) {
    throw new DungeonRuleError(messages(locale, 'text11'));
  }
  const player = createPlayer(actorId, actorName, false);
  return appendLog(
    { ...state, players: [...state.players, player] },
    messages(locale, 'text12', { p0: player.name }),
  );
}

function startExpedition(
  state: Readonly<DungeonState>,
  actorId: string,
  locale?: Locale,
): DungeonState {
  if (state.phase !== 'lobby') {
    throw new DungeonRuleError(messages(locale, 'text13'));
  }
  if (state.ownerId !== actorId) {
    throw new DungeonRuleError(messages(locale, 'text14'));
  }
  const waiting = state.players.filter((player) => !player.ready);
  if (waiting.length > 0) {
    throw new DungeonRuleError(
      messages(locale, 'text15', { p0: waiting.map((player) => player.name).join('、') }),
    );
  }
  return appendLog({ ...state, phase: 'exploring' }, messages(locale, 'text16'));
}

function assertActorTurn(state: Readonly<DungeonState>, actorId: string, locale?: Locale): void {
  if (state.phase === 'lobby') {
    throw new DungeonRuleError(messages(locale, 'text17'));
  }
  const current = activePlayer(state);
  if (!current || current.id !== actorId) {
    throw new DungeonRuleError(messages(locale, 'text18', { p0: current?.name ?? messages(locale, 'otherPlayer') }));
  }
}

function explore(
  state: Readonly<DungeonState>,
  random: DeterministicRandom,
  locale?: Locale,
): DungeonState {
  if (state.phase !== 'exploring') {
    throw new DungeonRuleError(messages(locale, 'text19'));
  }
  const room = state.room + 1;
  if (room >= BOSS_ROOM) {
    const enemy = createEnemy(state.floor, true, random, locale);
    return appendLog(
      { ...state, room, phase: 'combat', enemy },
      messages(locale, 'text20', { p0: enemy.name }),
    );
  }
  const roll = random.int(100);
  if (roll < 58) {
    const enemy = createEnemy(state.floor, false, random, locale);
    return appendLog(
      { ...state, room, phase: 'combat', enemy },
      messages(locale, 'text21', { p0: enemy.name }),
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
      messages(locale, 'text22', { p0: gold }),
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
      messages(locale, 'text23'),
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
    messages(locale, 'text24', { p0: target?.name ?? messages(locale, 'player'), p1: damage }),
  );
  const resolved = finishIfDefeated(trapped, locale);
  if (resolved.phase === 'completed' || (players[targetIndex]?.hp ?? 0) > 0) {
    return resolved;
  }
  return advanceTurn(resolved);
}

function attack(
  state: Readonly<DungeonState>,
  actorIndex: number,
  random: DeterministicRandom,
  locale?: Locale,
): DungeonState {
  if (state.phase !== 'combat' || !state.enemy) {
    throw new DungeonRuleError(messages(locale, 'text25'));
  }
  const actor = state.players[actorIndex];
  if (!actor || actor.hp <= 0) throw new DungeonRuleError(messages(locale, 'text26'));
  const damage = random.intInclusive(12, 22);
  const enemy = { ...state.enemy, hp: Math.max(0, state.enemy.hp - damage) };
  let next = appendLog(
    { ...state, enemy },
    messages(locale, 'text27', { p0: actor.name, p1: enemy.name, p2: damage }),
  );
  if (enemy.hp <= 0) return defeatEnemy(next, random, locale);
  next = enemyTurn(next, actorIndex, random, locale);
  return advanceTurn(finishIfDefeated(next, locale));
}

function defend(
  state: Readonly<DungeonState>,
  actorIndex: number,
  random: DeterministicRandom,
  locale?: Locale,
): DungeonState {
  if (state.phase !== 'combat' || !state.enemy) {
    throw new DungeonRuleError(messages(locale, 'text28'));
  }
  const actor = state.players[actorIndex];
  if (!actor || actor.hp <= 0) throw new DungeonRuleError(messages(locale, 'text26'));
  const players = state.players.map((player, index) =>
    index === actorIndex ? { ...player, guard: 8 } : player);
  let next = appendLog({ ...state, players }, messages(locale, 'text29', { p0: actor.name }));
  next = enemyTurn(next, actorIndex, random, locale);
  return advanceTurn(finishIfDefeated(next, locale));
}

function drinkPotion(
  state: Readonly<DungeonState>,
  actorIndex: number,
  random: DeterministicRandom,
  locale?: Locale,
): DungeonState {
  const actor = state.players[actorIndex];
  if (!actor || actor.hp <= 0) throw new DungeonRuleError(messages(locale, 'text26'));
  if (actor.potions <= 0) throw new DungeonRuleError(messages(locale, 'text30'));
  if (actor.hp >= actor.maxHp) throw new DungeonRuleError(messages(locale, 'text31'));
  const players = state.players.map((player, index) =>
    index === actorIndex
      ? {
          ...player,
          hp: Math.min(player.maxHp, player.hp + 30),
          potions: player.potions - 1,
        }
      : player);
  let next = appendLog({ ...state, players }, messages(locale, 'text32', { p0: actor.name }));
  if (state.phase === 'combat') {
    next = enemyTurn(next, actorIndex, random, locale);
    return advanceTurn(finishIfDefeated(next, locale));
  }
  return next;
}

function enemyTurn(
  state: Readonly<DungeonState>,
  targetIndex: number,
  random: DeterministicRandom,
  locale?: Locale,
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
    messages(locale, 'text33', { p0: enemy.name, p1: target.name, p2: damage }),
  );
}

function defeatEnemy(
  state: Readonly<DungeonState>,
  random: DeterministicRandom,
  locale?: Locale,
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
    }, messages(locale, 'text34', { p0: gold }));
  }
  if (enemy.boss) {
    return appendLog({
      ...rewarded,
      phase: 'exploring',
      floor: state.floor + 1,
      room: 0,
      roomsCleared: state.roomsCleared + 1,
    }, messages(locale, 'text35', { p0: gold }));
  }
  return advanceAfterRoom(
    { ...rewarded, phase: 'exploring' },
    messages(locale, 'text36', { p0: enemy.name, p1: gold }),
  );
}

function createEnemy(
  floor: number,
  boss: boolean,
  random: DeterministicRandom,
  locale?: Locale,
): DungeonEnemy {
  const names = boss
    ? [messages(locale, 'text37'), messages(locale, 'text38'), messages(locale, 'text39')]
    : [messages(locale, 'text40'), messages(locale, 'text41'), messages(locale, 'text42'), messages(locale, 'text43')];
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

function finishIfDefeated(state: Readonly<DungeonState>, locale?: Locale): DungeonState {
  if (state.players.some((player) => player.hp > 0)) return state as DungeonState;
  return appendLog({
    ...state,
    phase: 'completed',
    result: 'defeat',
    enemy: null,
  }, messages(locale, 'text44'));
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

const messages = createMessages({
  otherPlayer: { 'zh-CN': '其他队员', en: 'another player' },
  player: { 'zh-CN': '队员', en: 'A player' },
  text1: { 'zh-CN': "{p0} 创建了远征队。", en: "{p0} created the expedition party." },
  text2: { 'zh-CN': "本次远征已经结束。", en: "This expedition has ended." },
  text3: { 'zh-CN': "你还没有加入这支远征队。", en: "You have not joined this expedition." },
  text4: { 'zh-CN': "只有队长可以结束整支远征。", en: "Only the leader may end the expedition." },
  text5: { 'zh-CN': "队长结束了本次远征。", en: "The leader ended the expedition." },
  text6: { 'zh-CN': "远征已经开始，无法修改准备状态。", en: "The expedition has started; readiness can no longer be changed." },
  text7: { 'zh-CN': "已准备", en: " is ready" },
  text8: { 'zh-CN': "取消准备", en: " is no longer ready" },
  text9: { 'zh-CN': "远征已经出发，无法中途加入。", en: "The expedition has started; you cannot join mid-game." },
  text10: { 'zh-CN': "你已经在远征队中。", en: "You are already in the party." },
  text11: { 'zh-CN': "远征队已满，最多 4 人。", en: "The party is full (maximum four players)." },
  text12: { 'zh-CN': "{p0} 加入了远征队。", en: "{p0} joined the party." },
  text13: { 'zh-CN': "远征已经开始。", en: "The expedition has already started." },
  text14: { 'zh-CN': "只有队长可以带队出发。", en: "Only the leader may start the expedition." },
  text15: { 'zh-CN': "仍有队员未准备：{p0}", en: "Players not ready: {p0}" },
  text16: { 'zh-CN': "远征队进入了第一层地牢。", en: "The party entered the first floor." },
  text17: { 'zh-CN': "请先由队长开始远征。", en: "Ask the leader to start the expedition first." },
  text18: { 'zh-CN': "现在轮到 {p0} 行动。", en: "It is {p0}’s turn." },
  text19: { 'zh-CN': "战斗尚未结束，无法继续探索。", en: "Finish the battle before exploring further." },
  text20: { 'zh-CN': "守层者 {p0} 挡住了去路！", en: "Floor guardian {p0} blocks the way!" },
  text21: { 'zh-CN': "遭遇了 {p0}！", en: "Encountered {p0}!" },
  text22: { 'zh-CN': "发现宝箱，每位队员获得 {p0} 金币。", en: "A treasure chest! Each player gains {p0} gold." },
  text23: { 'zh-CN': "发现治愈泉，队伍恢复了生命。", en: "A healing spring restores the party’s health." },
  text24: { 'zh-CN': "{p0} 触发陷阱，受到 {p1} 点伤害。", en: "{p0} triggered a trap and took {p1} damage." },
  text25: { 'zh-CN': "当前没有可以攻击的敌人。", en: "There is no enemy to attack." },
  text26: { 'zh-CN': "倒下的队员无法行动。", en: "Defeated players cannot act." },
  text27: { 'zh-CN': "{p0} 对 {p1} 造成 {p2} 点伤害。", en: "{p0} dealt {p2} damage to {p1}." },
  text28: { 'zh-CN': "当前不需要防御。", en: "There is no need to defend right now." },
  text29: { 'zh-CN': "{p0} 架起了盾牌。", en: "{p0} raised a shield." },
  text30: { 'zh-CN': "你的药水已经用完了。", en: "You have no potions left." },
  text31: { 'zh-CN': "你的生命值已经满了。", en: "Your health is already full." },
  text32: { 'zh-CN': "{p0} 使用药水恢复生命。", en: "{p0} used a potion to restore health." },
  text33: { 'zh-CN': "{p0} 反击 {p1}，造成 {p2} 点伤害。", en: "{p0} counterattacked {p1} for {p2} damage." },
  text34: { 'zh-CN': "击败最终守层者，每人获得 {p0} 金币。远征胜利！", en: "The final guardian is defeated! Each player gains {p0} gold. Expedition victory!" },
  text35: { 'zh-CN': "击败守层者，每人获得 {p0} 金币。队伍进入下一层。", en: "The floor guardian is defeated! Each player gains {p0} gold. The party advances to the next floor." },
  text36: { 'zh-CN': "击败 {p0}，每人获得 {p1} 金币。", en: "Defeated {p0}! Each player gains {p1} gold." },
  text37: { 'zh-CN': "石像守卫", en: "Stone Guardian" },
  text38: { 'zh-CN': "深渊术士", en: "Abyss Warlock" },
  text39: { 'zh-CN': "远古龙影", en: "Ancient Dragon Shade" },
  text40: { 'zh-CN': "洞穴史莱姆", en: "Cave Slime" },
  text41: { 'zh-CN': "骷髅巡卫", en: "Skeleton Patrol" },
  text42: { 'zh-CN': "暗影猎手", en: "Shadow Hunter" },
  text43: { 'zh-CN': "失控魔像", en: "Rampaging Golem" },
  text44: { 'zh-CN': "远征队全员倒下，本次远征失败。", en: "The entire party fell. The expedition failed." },
});
