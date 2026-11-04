import { createMessages, type Locale } from '@zhin.js/plugin-runtime';
import type { GamePlayer } from './command-message.js';

const messages = createMessages({
  help: { 'zh-CN': '帮助', en: 'Help' },
  start: { 'zh-CN': '开始新局', en: 'Start a game' },
  continue: { 'zh-CN': '继续当前对局', en: 'Continue the current game' },
  quit: { 'zh-CN': '结束当前对局', en: 'End the current game' },
  bot: { 'zh-CN': '人机对战', en: 'Play against the bot' },
  join: { 'zh-CN': '加入排队', en: 'Join the queue' },
  leave: { 'zh-CN': '离开排队', en: 'Leave the queue' },
  spectate: { 'zh-CN': '观战', en: 'Spectate' },
  unknown: { 'zh-CN': '未知子命令：{action}', en: 'Unknown subcommand: {action}' },
  noGame: { 'zh-CN': '你没有进行中的对局。', en: 'You have no active game.' },
  startHint: { 'zh-CN': '发送「{command}」开始。', en: 'Send “{command}” to start.' },
});

export function gameCommandHint(message: Pick<GamePlayer, 'locale' | 'formatCommand'>, path: string, action = 'start'): string {
  const command = message.formatCommand?.(path);
  return command === undefined ? '' : messages(message.locale, 'startHint', { command: `${command} ${action}` });
}

export interface GameHelpRequest {
  /** Locale and command formatter of the actual presenting operation. */
  readonly presentation: Pick<GamePlayer, 'locale' | 'formatCommand'>;
  readonly title: Readonly<Record<Locale, string>>;
  readonly commandPath: string;
  readonly actions: readonly ('start' | 'continue' | 'quit' | 'bot' | 'join' | 'leave' | 'spectate')[];
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
    for (const action of actions) lines.push(`${command} ${action} — ${messages(locale, action)}`);
  }
  if (footer) lines.push('', footer[locale]);
  return lines.join('\n');
}

export function gameCommandFeedback(message: Pick<GamePlayer, 'locale'>, key: 'unknown', action: string): string;
export function gameCommandFeedback(message: Pick<GamePlayer, 'locale'>, key: 'noGame'): string;
export function gameCommandFeedback(message: Pick<GamePlayer, 'locale'>, key: 'unknown' | 'noGame', action = ''): string {
  return messages(message.locale, key, { action });
}
