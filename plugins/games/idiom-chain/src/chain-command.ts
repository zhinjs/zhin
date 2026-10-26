import { formatGameHelp, gameCommandFeedback, gameCommandHint, channelKey, type GameMessageLike, type GameReply } from '@zhin.js/game-kit';
import { createMessages } from 'zhin.js/i18n';
import { continueGame, startGame } from './game-flow.js';
import { idiomCount, modeLabel, promptLine, type MatchMode } from './engine.js';

import type { SessionService } from './session-service.js';


const messages = createMessages({
  dictionary: { 'zh-CN': '开源词库 {count} 条 · 机器人先出第一句', en: 'Dictionary: {count} entries · The bot plays first' },
  pinyin: { 'zh-CN': '{command} — 同音接龙', en: '{command} — Match the pronunciation' },
  char: { 'zh-CN': '{command} — 严格同字接龙', en: '{command} — Match the character' },
  instructions: { 'zh-CN': '进行中直接回复四字成语。按钮：提示 · 跳过 · 认输（失误 3 次判负）。', en: 'Reply with four-character Chinese idioms. Options: Hint · Skip · Concede. Three mistakes lose the game.' },
  active: { 'zh-CN': '进行中：{player} · {mode} · 局分 {playerScore}:{botScore} · 连击 {streak}', en: 'Playing: {player} · {mode} · Score {playerScore}:{botScore} · Streak {streak}' },
  quit: { 'zh-CN': '已放弃成语接龙。', en: 'You quit the idiom chain.' },
});

export function getChainHelp(message: Pick<GameMessageLike, 'locale' | 'formatCommand'> = {}): string {
  const locale = message.locale ?? 'zh-CN';
  const command = message.formatCommand?.('chain');
  return [formatGameHelp(message, { 'zh-CN': '📜 成语接龙（文字接龙 · 四字成语）', en: '📜 Chinese Idiom Chain' }, 'chain', ['continue', 'quit']),
    messages(locale, 'dictionary', { count: idiomCount() }),
    ...(command ? [messages(locale, 'pinyin', { command: command + ' start_pinyin' }), messages(locale, 'char', { command: command + ' start_char' })] : []),
    messages(locale, 'instructions'),
  ].join('\n');
}
export const CHAIN_HELP = getChainHelp();

export async function runChainCommand(
  services: SessionService,
  message: GameMessageLike,
  action: string,
): Promise<GameReply> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveByChannel(ch);
    const lines = [getChainHelp(message), ''];
    if (active) {
      const mode: MatchMode = active.match_mode === 'char' ? 'char' : 'pinyin';
      lines.push(
        messages(active.locale ?? undefined, 'active', { player: active.player_name, mode: modeLabel(mode, active.locale ?? undefined), playerScore: active.player_score, botScore: active.bot_score, streak: active.streak }),
      );
      if (active.last_idiom) lines.push(promptLine(active.last_idiom, mode, active.locale ?? undefined));
    } else {
      lines.push(gameCommandFeedback(message, 'noGame'), gameCommandHint(message, 'chain', 'start_pinyin'));
    }
    return lines.join('\n');
  }

  if (action === 'start_pinyin') return (await startGame(services, message, 'pinyin')) ?? '';
  if (action === 'start_char') return (await startGame(services, message, 'char')) ?? '';
  if (action === 'continue') return continueGame(services, message);

  if (action === 'quit') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return gameCommandFeedback(message, 'noGame');
    await services.updateSession(row.id, { status: 'aborted' });
    return messages(row.locale ?? undefined, 'quit');
  }

  return gameCommandFeedback(message, 'unknown', action) + '\n\n' + getChainHelp(message);
}
