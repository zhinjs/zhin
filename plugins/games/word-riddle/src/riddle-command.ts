import { formatGameHelp, gameCommandFeedback, gameCommandHint, channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import { createMessages } from 'zhin.js/i18n';
import { continueGame, startGame } from './game-flow.js';
import { riddleCount, type RiddleType } from './riddles-catalog.js';

import { typeLabel } from './engine.js';
import type { SessionService } from './session-service.js';

const counts = riddleCount();


const messages = createMessages({
  counts: { 'zh-CN': '字谜 {chars} 题 · 成语 {idioms} 题', en: '{chars} character riddles · {idioms} idiom riddles' },
  char: { 'zh-CN': '{command} — 字谜模式', en: '{command} — Chinese character riddles' },
  idiom: { 'zh-CN': '{command} — 猜成语模式', en: '{command} — Chinese idiom riddles' },
  instructions: { 'zh-CN': '进行中直接回复答案；连击加分，提示/失误会清零连击。', en: 'Reply with the answer during play. Streaks earn bonus points; hints and mistakes reset the streak.' },
  active: { 'zh-CN': '进行中：{mode} · 得分 {score} · 连击 {streak}', en: 'Playing: {mode} · Score {score} · Streak {streak}' },
  quit: { 'zh-CN': '已放弃猜谜。', en: 'You quit the riddle game.' },
});

export function getRiddleHelp(message: Pick<GamePlayer, 'locale' | 'formatCommand'> = {}): string {
  const locale = message.locale ?? 'zh-CN';
  const command = message.formatCommand?.('riddle');
  return [formatGameHelp({ presentation: message, title: { 'zh-CN': '🧩 猜谜（字谜 + 猜成语）', en: '🧩 Chinese Character and Idiom Riddles' }, commandPath: 'riddle', actions: ['start', 'continue', 'quit'] }),
    messages(locale, 'counts', { chars: counts.char.toLocaleString(locale), idioms: counts.idiom.toLocaleString(locale) }),
    ...(command ? [messages(locale, 'char', { command: command + ' char' }), messages(locale, 'idiom', { command: command + ' idiom' })] : []),
    messages(locale, 'instructions'),
  ].join('\n');
}
export const RIDDLE_HELP = getRiddleHelp();

function parseMode(action: string): RiddleType | null {
  if (action === 'char' || action === '字谜') return 'char';
  if (action === 'idiom' || action === '成语') return 'idiom';
  if (action === 'start' || action === '开始') return 'char';
  return null;
}

export async function runRiddleCommand(
  services: SessionService,
  message: GamePlayer,
  action: string,
): Promise<GameReply> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const userId = message.sender.id;

    if (!action || action === 'help') {
      const active = await services.getActiveByChannel(ch);
      const lines = [getRiddleHelp(message), ''];
      if (active) {
        lines.push(messages(active.locale ?? undefined, 'active', { mode: typeLabel(active.mode as RiddleType, active.locale ?? undefined), score: active.score, streak: active.streak }));
      } else {
        lines.push(gameCommandFeedback(message, 'noGame'), gameCommandHint(message, 'riddle'));
      }
      return lines.join('\n');
    }

    const mode = parseMode(action);
    if (mode) return (await startGame(services, message, mode)) ?? '';

    if (action === 'continue' || action === '继续') {
      return continueGame(services, message);
    }

    if (action === 'quit' || action === '放弃') {
      const row = await services.getActiveForUser(ch, userId);
      if (!row) return gameCommandFeedback(message, 'noGame');
      await services.updateSession(row.id, { status: 'aborted' });
      return messages(row.locale ?? undefined, 'quit');
    }

    return gameCommandFeedback(message, 'unknown', action) + '\n\n' + getRiddleHelp(message);
  } });
}
