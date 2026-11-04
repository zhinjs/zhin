import { createMessages } from 'zhin.js/i18n';
import type { GamePlayer } from '@zhin.js/game-kit';
export type RouletteCommandAction =
  | 'help'
  | 'open'
  | 'join'
  | 'start'
  | 'fire'
  | 'leave'
  | 'cancel'
  | 'status'
  | 'penalty-on'
  | 'penalty-off'
  | 'penalty-status';

const ACTION_WORDS: Readonly<Record<string, RouletteCommandAction>> = {
  help: 'help',
  帮助: 'help',
  规则: 'help',
  open: 'open',
  开局: 'open',
  创建: 'open',
  join: 'join',
  加入: 'join',
  start: 'start',
  开始: 'start',
  fire: 'fire',
  shoot: 'fire',
  开枪: 'fire',
  扣动扳机: 'fire',
  leave: 'leave',
  退出: 'leave',
  离开: 'leave',
  认输: 'leave',
  cancel: 'cancel',
  取消: 'cancel',
  status: 'status',
  状态: 'status',
  'mute-on': 'penalty-on',
  开启禁言: 'penalty-on',
  'mute-off': 'penalty-off',
  关闭禁言: 'penalty-off',
  mute: 'penalty-status',
  禁言: 'penalty-status',
};

/** Empty input means help; unknown words return null so normal chat is never hijacked. */
export function normalizeRouletteAction(raw: string): RouletteCommandAction | null {
  const word = raw.trim();
  if (!word) return 'help';
  return ACTION_WORDS[word] ?? ACTION_WORDS[word.toLowerCase()] ?? null;
}


const messages = createMessages({
  title: { 'zh-CN': '🔫 俄罗斯轮盘（2 人起，轮流开枪，中弹者输）', en: '🔫 Russian Roulette (two or more players, take turns; the player hit loses)' },
  open: { 'zh-CN': '创建一局并上桌', en: 'Open a lobby and join it' },
  join: { 'zh-CN': '加入等待中的对局', en: 'Join a waiting lobby' },
  start: { 'zh-CN': '房主开局（弹巢随机装 1 发子弹）', en: 'Host starts the game (one randomly placed bullet)' },
  fire: { 'zh-CN': '轮到你时扣动扳机', en: 'Pull the trigger on your turn' },
  leave: { 'zh-CN': '等待时离开；对局中离开算认输', en: 'Leave the lobby; leaving during play forfeits the game' },
  cancel: { 'zh-CN': '房主或管理员取消本局（不计分）', en: 'Host or manager cancels the game (no score)' },
  status: { 'zh-CN': '查看当前对局', en: 'View the current game' },
  mute: { 'zh-CN': '查看禁言惩罚', en: 'View the mute penalty setting' },
  'mute-on': { 'zh-CN': '开启本群禁言惩罚', en: 'Enable mute penalties for this group' },
  'mute-off': { 'zh-CN': '关闭本群禁言惩罚', en: 'Disable mute penalties for this group' },
  rules: { 'zh-CN': '规则：按加入顺序轮流开枪；轮到的人超时不开枪判负；幸存者各记 1 胜，输家记 1 负。禁言惩罚默认关闭。', en: 'Players take turns in join order. Missing your turn deadline loses the game. Each survivor gets one win; the loser gets one loss. Mute penalties are off by default.' },
});
export function getRouletteHelp(message: Pick<GamePlayer, 'locale' | 'formatCommand'> = {}): string {
  const command = message.formatCommand?.('roulette');
  const actions = ['open', 'join', 'start', 'fire', 'leave', 'cancel', 'status', 'mute', 'mute-on', 'mute-off'] as const;
  return [messages(message.locale, 'title'),
    ...(command === undefined ? [] : actions.map(action => `${command} ${action} — ${messages(message.locale, action)}`)),
    '', messages(message.locale, 'rules')].join('\n');
}
export const ROULETTE_HELP = getRouletteHelp();
