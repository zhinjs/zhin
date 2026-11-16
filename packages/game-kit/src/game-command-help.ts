import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import type { GamePlayer } from './command-message.js';

const messages = createMessages({
  help: { 'zh-CN': '帮助', en: 'Help' },
  start: { 'zh-CN': '开始新局', en: 'Start a game' },
  continue: { 'zh-CN': '继续当前对局', en: 'Continue the current game' },
  quit: { 'zh-CN': '结束当前对局（不计胜负）', en: 'End the current game (no result recorded)' },
  forfeit: { 'zh-CN': '认输并结束对局', en: 'Concede and end the game' },
  bot: { 'zh-CN': '人机对战', en: 'Play against the bot' },
  join: { 'zh-CN': '加入排队', en: 'Join the queue' },
  leave: { 'zh-CN': '离开排队', en: 'Leave the queue' },
  spectate: { 'zh-CN': '观战', en: 'Spectate' },
  unknown: { 'zh-CN': '未知子命令：{action}', en: 'Unknown subcommand: {action}' },
  noGame: { 'zh-CN': '你没有进行中的对局。', en: 'You have no active game.' },
  startHint: { 'zh-CN': '发送「{command}」开始。', en: 'Send “{command}” to start.' },
});

/**
 * 游戏子命令的命名约定（#1250 game-command-names-mixed-language，见 plugins/games/README.md）：
 * 每个子命令有英文名与中文名，两者都被各游戏的 action 表接受；帮助与提示按**命令名本身的语言**
 * 选用：命令名含汉字（`猜数字`、`井字棋`）就写中文子命令，否则写英文（`guess`、`ttt`）。
 * `forfeit` 是会判负的 `quit`（对手记一胜），中文名为「认输」。
 */
const GAME_ACTION_NAMES: Readonly<Record<string, Readonly<{ zh: string; en: string }>>> = Object.freeze({
  start: { zh: '开始', en: 'start' },
  continue: { zh: '继续', en: 'continue' },
  quit: { zh: '退出', en: 'quit' },
  forfeit: { zh: '认输', en: 'quit' },
  bot: { zh: '人机', en: 'bot' },
  join: { zh: '加入', en: 'join' },
  leave: { zh: '离开', en: 'leave' },
  spectate: { zh: '观战', en: 'spectate' },
  help: { zh: '帮助', en: 'help' },
});

const HAN = /\p{Script=Han}/u;

/** 子命令在给定命令名下的写法：与命令名同一种语言；表外的 action 原样返回。 */
function gameActionName(command: string, action: string): string {
  const names = GAME_ACTION_NAMES[action];
  if (!names) return action;
  return HAN.test(command) ? names.zh : names.en;
}

export function gameCommandHint(message: Pick<GamePlayer, 'locale' | 'formatCommand'>, path: string, action = 'start'): string {
  const command = message.formatCommand?.(path);
  return command === undefined ? '' : messages(message.locale, 'startHint', { command: `${command} ${gameActionName(command, action)}` });
}

export interface GameHelpRequest {
  /** Locale and command formatter of the actual presenting operation. */
  readonly presentation: Pick<GamePlayer, 'locale' | 'formatCommand'>;
  readonly title: Readonly<Record<Locale, string>>;
  readonly commandPath: string;
  /** `quit` 只结束对局、不计胜负；`forfeit` 是判负的退出（对手记一胜），帮助写「认输并结束对局」。 */
  readonly actions: readonly ('start' | 'continue' | 'quit' | 'forfeit' | 'bot' | 'join' | 'leave' | 'spectate')[];
  readonly footer?: Readonly<Record<Locale, string>>;
}

/** Only render invocations confirmed by the current operation's CommandIndex. */
export function formatGameHelp(input: GameHelpRequest): string {
  const { presentation: message, title, commandPath: path, actions, footer } = input;
  const locale = message.locale ?? 'zh-CN';
  const lines = [title[locale]];
  const command = message.formatCommand?.(path);
  if (command !== undefined) {
    lines.push(`${command} --help — ${messages(locale, 'help')}`);
    for (const action of actions) lines.push(`${command} ${gameActionName(command, action)} — ${messages(locale, action)}`);
  }
  if (footer) lines.push('', footer[locale]);
  return lines.join('\n');
}

export function gameCommandFeedback(message: Pick<GamePlayer, 'locale'>, key: 'unknown', action: string): string;
export function gameCommandFeedback(message: Pick<GamePlayer, 'locale'>, key: 'noGame'): string;
export function gameCommandFeedback(message: Pick<GamePlayer, 'locale'>, key: 'unknown' | 'noGame', action = ''): string {
  return messages(message.locale, key, { action });
}
