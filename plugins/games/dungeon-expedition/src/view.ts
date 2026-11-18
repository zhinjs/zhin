import { createMessages, resolveLocale, type Locale } from 'zhin.js/i18n';
import type { SendContent } from '@zhin.js/core/runtime';
import {
  buildChoiceKeyboard,
  type ChoiceOption,
} from '@zhin.js/game-kit';
import { activePlayer, type DungeonState } from './engine.js';
import type { DungeonSessionRow } from './models.js';

export const DUNGEON_PREFIX = 'dungeon';

export function dungeonSessionToken(session: DungeonSessionRow): string {
  return `${session.id}@${session.revision}`;
}

export function parseDungeonSessionToken(
  token: string,
): { sessionId: string; revision: number } | null {
  const match = /^(.+)@(\d+)$/.exec(token);
  if (!match?.[1] || match[2] === undefined) return null;
  return { sessionId: match[1], revision: Number(match[2]) };
}

/**
 * Buttons for the current state. A group card is shared by the whole channel, so every viewer gets
 * the same buttons in the same order (#1250): the lobby always offers 加入 / 准备 / 开始 / 解散,
 * and a number means the same action for everyone. Who may do what is checked when the action
 * arrives (a non-leader's 开始 or 解散 is refused with a reason).
 */
export function choicesForState(state: Readonly<DungeonState>, locale?: Locale): ChoiceOption[] {
  return allChoicesForState(state, locale);
}

/** The leader's end-confirmation choices (#1250); numbered 1 / 2 like the confirmation card. */
export function abortConfirmChoices(locale?: Locale): ChoiceOption[] {
  return [
    { id: 'abort_confirm', label: messages(locale, 'confirmEndYes'), style: 'danger' },
    { id: 'status', label: messages(locale, 'confirmEndNo'), style: 'secondary' },
  ];
}

/** Whether `state` carries a leader's end request made at the session's current revision. */
export function hasPendingAbort(session: Pick<DungeonSessionRow, 'revision'>, state: Readonly<DungeonState>): boolean {
  return state.pendingAbortRevision !== undefined && state.pendingAbortRevision === session.revision;
}

/** Party size limit (engine `joinParty`). */
const MAX_PARTY = 4;

/** Leader's confirmation before the expedition ends (#1250). */
export function buildDungeonAbortConfirm(session: DungeonSessionRow, state: Readonly<DungeonState>, channelType?: string): SendContent {
  const locale = resolveLocale(session.locale);
  return buildChoiceKeyboard({
    gamePrefix: DUNGEON_PREFIX,
    sessionId: dungeonSessionToken(session),
    narrative: [messages(locale, 'confirmEnd'), summaryLine(state, locale)].join('\n'),
    choices: abortConfirmChoices(locale),
    buttonsPerRow: 2,
    locale,
    interactionProfile: 'gameplay',
    channelType,
  });
}

function summaryLine(state: Readonly<DungeonState>, locale?: Locale): string {
  const gold = state.players.reduce((sum, player) => sum + player.gold, 0);
  return messages(locale, 'summary', { floor: state.floor, rooms: state.roomsCleared, gold });
}

function allChoicesForState(state: Readonly<DungeonState>, locale?: Locale): ChoiceOption[] {
  if (state.phase === 'completed') {
    return [{
      id: 'restart',
      label: messages(locale, 'text1'),
      style: 'primary',
      keepEnabledWhenTerminal: true,
    }];
  }
  if (state.phase === 'lobby') {
    return [
      { id: 'join', label: messages(locale, 'text2'), style: 'secondary' },
      { id: 'ready', label: messages(locale, 'text3'), style: 'secondary' },
      { id: 'start', label: messages(locale, 'text4'), style: 'primary' },
      { id: 'abort', label: messages(locale, 'text5'), style: 'danger' },
    ];
  }
  if (state.phase === 'combat') {
    return [
      { id: 'attack', label: messages(locale, 'text6'), style: 'primary' },
      { id: 'defend', label: messages(locale, 'text7'), style: 'secondary' },
      { id: 'potion', label: messages(locale, 'text8'), style: 'secondary' },
      { id: 'abort', label: messages(locale, 'text9'), style: 'danger' },
    ];
  }
  return [
    { id: 'explore', label: messages(locale, 'text10'), style: 'primary' },
    { id: 'potion', label: messages(locale, 'text11'), style: 'secondary' },
    { id: 'abort', label: messages(locale, 'text9'), style: 'danger' },
  ];
}

export function buildDungeonView(
  session: DungeonSessionRow,
  state: Readonly<DungeonState>,
  channelType?: string,
): SendContent {
  const locale = resolveLocale(session.locale);
  const current = activePlayer(state);
  const lines = [
    messages(locale, 'text12', { p0: state.floor, p1: 3, p2: state.room, p3: 4 }),
    messages(locale, 'text13', { p0: phaseLabel(state, locale) }),
    '',
    ...state.players.map((player, index) => {
      const turn = current?.id === player.id && state.phase !== 'lobby' ? messages(locale, 'text14') : '';
      const ready = state.phase === 'lobby' ? player.ready ? messages(locale, 'text15') : messages(locale, 'text16') : '';
      return `${index + 1}. ${player.name}${ready} HP ${player.hp}/${player.maxHp}`
        + messages(locale, 'text17', { p0: player.potions, p1: player.gold, p2: turn });
    }),
  ];
  if (state.enemy) {
    lines.push(
      '',
      `${state.enemy.boss ? messages(locale, 'text18') : messages(locale, 'text19')}：${state.enemy.name}`,
      messages(locale, 'text20', { p0: state.enemy.hp, p1: state.enemy.maxHp, p2: state.enemy.attack }),
    );
  }
  lines.push('', messages(locale, 'text21'), ...state.log.slice(-4).map((line) => `- ${line}`));
  if (state.phase === 'completed') {
    lines.push(
      '',
      state.result === 'victory'
        ? messages(locale, 'text22')
        : state.result === 'aborted'
          ? messages(locale, 'text23')
          : messages(locale, 'text24'),
      summaryLine(state, locale),
    );
  }
  if (state.phase === 'lobby' && state.players.length < MAX_PARTY) lines.push('', messages(locale, 'joinHint'));

  const choices = choicesForState(state, locale);
  return buildChoiceKeyboard({
    gamePrefix: DUNGEON_PREFIX,
    sessionId: dungeonSessionToken(session),
    narrative: lines.join('\n'),
    choices,
    terminal: state.phase === 'completed',
    buttonsPerRow: 2,
    locale,
    interactionProfile: state.phase === 'completed' ? 'terminal' : 'gameplay',
    channelType,
  });
}

function phaseLabel(state: Readonly<DungeonState>, locale?: Locale): string {
  if (state.phase === 'lobby') return messages(locale, 'text25');
  if (state.phase === 'exploring') return messages(locale, 'text26');
  if (state.phase === 'combat') return messages(locale, 'text27');
  if (state.result === 'victory') return messages(locale, 'text28');
  if (state.result === 'aborted') return messages(locale, 'text29');
  return messages(locale, 'text30');
}

const messages = createMessages({
  confirmEnd: { 'zh-CN': "确定要结束本次远征吗？", en: "End this expedition?" },
  confirmEndYes: { 'zh-CN': "确认结束", en: "End it" },
  confirmEndNo: { 'zh-CN': "继续远征", en: "Keep going" },
  summary: { 'zh-CN': "本局结算：到达第 {floor} 层 · 清理 {rooms} 个房间 · 队伍金币 {gold}", en: "Round summary: reached floor {floor} · {rooms} rooms cleared · party gold {gold}" },
  joinHint: { 'zh-CN': "其他人回复「加入队伍」入队；全员准备后由队长开始远征。", en: "Others reply 加入队伍 (Join party) to join; the leader starts once everyone is ready." },
  text1: { 'zh-CN': "再来一局", en: "Play again" },
  text2: { 'zh-CN': "加入队伍", en: "Join party" },
  text3: { 'zh-CN': "准备/取消", en: "Ready / Not ready" },
  text4: { 'zh-CN': "开始远征", en: "Start expedition" },
  text5: { 'zh-CN': "解散队伍", en: "Disband party" },
  text6: { 'zh-CN': "攻击", en: "Attack" },
  text7: { 'zh-CN': "防御", en: "Defend" },
  text8: { 'zh-CN': "药水", en: "Potion" },
  text9: { 'zh-CN': "结束远征", en: "End expedition" },
  text10: { 'zh-CN': "探索下一房间", en: "Explore next room" },
  text11: { 'zh-CN': "使用药水", en: "Use potion" },
  text12: { 'zh-CN': "地牢远征 · 第 {p0}/{p1} 层 · 房间 {p2}/{p3}", en: "Dungeon Expedition · Floor {p0}/{p1} · Room {p2}/{p3}" },
  text13: { 'zh-CN': "状态：{p0}", en: "Status: {p0}" },
  text14: { 'zh-CN': " <- 当前回合", en: " <- Current turn" },
  text15: { 'zh-CN': " [已准备]", en: " [Ready]" },
  text16: { 'zh-CN': " [未准备]", en: " [Not ready]" },
  text17: { 'zh-CN': " · 药水 {p0} · 金币 {p1}{p2}", en: " · Potions {p0} · Gold {p1}{p2}" },
  text18: { 'zh-CN': "守层者", en: "Floor guardian" },
  text19: { 'zh-CN': "敌人", en: "Enemy" },
  text20: { 'zh-CN': "HP {p0}/{p1} · 攻击 {p2}", en: "HP {p0}/{p1} · Attack {p2}" },
  text21: { 'zh-CN': "最近事件：", en: "Recent events:" },
  text22: { 'zh-CN': "远征胜利，地牢已被征服。", en: "Expedition victory! The dungeon is conquered." },
  text23: { 'zh-CN': "本次远征由队长结束。", en: "The leader ended this expedition." },
  text24: { 'zh-CN': "远征失败，队伍全员倒下。", en: "Expedition failed. The entire party fell." },
  text25: { 'zh-CN': "等待队员", en: "Waiting for players" },
  text26: { 'zh-CN': "探索中", en: "Exploring" },
  text27: { 'zh-CN': "战斗中", en: "In combat" },
  text28: { 'zh-CN': "胜利", en: "Victory" },
  text29: { 'zh-CN': "已结束", en: "Ended" },
  text30: { 'zh-CN': "失败", en: "Defeat" },
});
