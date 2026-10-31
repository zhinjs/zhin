import { formatGameHelp, gameCommandFeedback, gameCommandHint, channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import { createMessages } from 'zhin.js/i18n';
import { continueGame, handleChoice, startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';

export function getDiceHelp(message: Pick<GamePlayer, 'locale' | 'formatCommand'> = {}): string {
  return formatGameHelp({ presentation: message, title: { 'zh-CN': "🎲 骰子对决（三局两胜）", en: "🎲 Dice Duel (best of three)" }, commandPath: 'dice', actions: ['start', 'continue', 'quit'], footer: { 'zh-CN': "点击按钮或回复选项数字掷骰。", en: "Choose a button or reply with its option number." } });
}

export const DICE_HELP = getDiceHelp();

export async function runDiceCommand(
  services: SessionService,
  message: GamePlayer,
  action: string,
): Promise<GameReply> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const userId = message.sender.id;

    if (!action || action === 'help') {
      const active = await services.getActiveByChannel(ch);
      const lines = [getDiceHelp(message), ''];
      if (active) {
        lines.push(messages(active.locale ?? undefined, 'text1', { p0: active.player_name, p1: active.player_wins, p2: active.bot_wins }));
      } else {
        lines.push(gameCommandFeedback(message, 'noGame'), gameCommandHint(message, 'dice'));
      }
      return lines.join('\n');
    }

    if (action === 'start') return (await startGame(services, message)) ?? '';
    if (action === 'continue') return continueGame(services, message);

    if (action === 'quit') {
      const row = await services.getActiveForUser(ch, userId);
      if (!row) return gameCommandFeedback(message, 'noGame');
      return (await handleChoice(services, message, row.id, 'quit')) ?? '';
    }

    return gameCommandFeedback(message, 'unknown', action) + '\n\n' + getDiceHelp(message);
  } });
}

const messages = createMessages({
  text1: { 'zh-CN': "进行中：{p0} · {p1}:{p2}", en: "Playing: {p0} · {p1}:{p2}" },
});
