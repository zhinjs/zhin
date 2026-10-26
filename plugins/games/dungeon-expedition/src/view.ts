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

export function choicesForState(state: Readonly<DungeonState>, locale?: Locale): ChoiceOption[] {
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
    );
  }

  const choices = choicesForState(state, locale);
  return buildChoiceKeyboard({
    gamePrefix: DUNGEON_PREFIX,
    sessionId: dungeonSessionToken(session),
    narrative: lines.join('\n'),
    choices,
    terminal: state.phase === 'completed',
    buttonsPerRow: 2,
    fallbackHint: choices.map((choice, index) =>
      `${index + 1} ${choice.label}`).join(' · '),
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
