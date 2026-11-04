import { channelKey, formatGameHelp, gameCommandFeedback, gameCommandHint, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import { continueGame, handleChoice, startGame } from './game-flow.js';
import type { SessionService } from './session-service.js';

export function getBjHelp(message: Pick<GamePlayer, 'locale' | 'formatCommand'> = {}): string {
  return formatGameHelp({ presentation: message, title: { 'zh-CN': "🃏 **21 点**", en: "🃏 **Blackjack**" }, commandPath: 'bj', actions: ['start', 'continue', 'quit'], footer: { 'zh-CN': "尽量让手牌点数接近 21 且不超过，比庄家大即获胜。对局中点击要牌或停牌。", en: "Get as close to 21 as possible without going over, and beat the dealer. Choose Hit or Stand during play." } });
}

export const BJ_HELP = getBjHelp();

export async function runBjCommand(
  services: SessionService,
  message: GamePlayer,
  action: string,
): Promise<GameReply> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const a = action.trim().toLowerCase() || 'help';
    if (a === 'help' || a === '帮助') return getBjHelp(message);
    if (a === 'start' || a === '开始') return (await startGame(services, message)) ?? '';
    if (a === 'continue' || a === '继续') return continueGame(services, message);
    if (a === 'quit' || a === '放弃') {
      const session = await services.getActiveForUser(
        channelKey(message),
        message.sender.id,
      );
      if (!session) return gameCommandFeedback(message, 'noGame');
      return (await handleChoice(services, message, session.id, 'quit')) ?? '';
    }
    return gameCommandFeedback(message, 'unknown', action) + '\n\n' + getBjHelp(message);
  } });
}
