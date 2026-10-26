import { formatGameHelp, gameCommandFeedback, gameCommandHint, channelKey, type GameMessageLike, type GameReply } from '@zhin.js/game-kit';
import { createMessages } from 'zhin.js/i18n';
import { startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';
import { buildGuessView } from './view.js';

export function getGuessHelp(message: Pick<GameMessageLike, 'locale' | 'formatCommand'> = {}): string {
  return formatGameHelp(message, { 'zh-CN': "猜数字（1~100，7 次机会）", en: "Guess the Number (1–100, seven guesses)" }, 'guess', ['start', 'quit'],
    { 'zh-CN': "进行中直接回复范围内的整数。", en: "During a game, reply with an integer in the range." });
}

export const GUESS_HELP = getGuessHelp();

export async function runGuessCommand(
  services: SessionService,
  message: GameMessageLike,
  action: string,
): Promise<GameReply> {
  const ch = channelKey(message);
  const userId = message.$sender.id;

  if (!action || action === 'help') {
    const active = await services.getActiveForUser(ch, userId);
    const lines = [getGuessHelp(message), ''];
    if (active) {
      return buildGuessView(active, [getGuessHelp(message)], message.$channel.type);
    } else {
      lines.push(gameCommandFeedback(message, 'noGame'), gameCommandHint(message, 'guess'));
    }
    return lines.join('\n');
  }

  if (action === 'start') return startGame(services, message);

  if (action === 'quit') {
    const row = await services.getActiveForUser(ch, userId);
    if (!row) return gameCommandFeedback(message, 'noGame');
    await services.updateSession(row.id, { status: 'aborted' });
    const updated = (await services.getById(row.id))!;
    return buildGuessView(updated, [messages(row.locale ?? undefined, 'text1')], message.$channel.type);
  }

  return gameCommandFeedback(message, 'unknown', action) + '\n\n' + getGuessHelp(message);
}

const messages = createMessages({
  text1: { 'zh-CN': "已放弃本局。", en: "You quit this game." },
});
