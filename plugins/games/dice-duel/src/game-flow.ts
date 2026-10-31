import { createMessages, resolveLocale } from 'zhin.js/i18n';
import { channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import type { DiceSessionRow } from './models.js';
import { compareRolls, DICE_PREFIX, rollD6, WIN_TARGET } from './engine.js';
import type { SessionService } from './session-service.js';
import { buildDiceView } from './view.js';

/**
 * Plugin Runtime: render the board as text. Interactive in-place board editing
 * (the old Adapter.editMessage path) is not part of the runtime flow; commands
 * and the choice middleware return fresh text each turn.
 */
function renderView(
  session: DiceSessionRow,
  message: GamePlayer,
  lastRound?: { player: number; bot: number; result: 0 | 1 | 2 },
): GameReply {
  return buildDiceView(session, lastRound, message.target.kind);
}

export async function startGame(
  services: SessionService,
  message: GamePlayer,
): Promise<GameReply | undefined> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const active = await services.getActiveByChannel(ch);
    const locale = resolveLocale(active ? active.locale : message.locale);
    if (active) {
      if (active.player_id === message.sender.id) {
        return messages(locale, 'text1');
      }
      return messages(locale, 'text2', { p0: active.player_name });
    }
    const session = await services.createSession(message);
    return renderView(session, message);
  } });
}

export async function continueGame(
  services: SessionService,
  message: GamePlayer,
): Promise<GameReply> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.getActiveForUser(
      channelKey(message),
      message.sender.id,
    );
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session) return messages(locale, 'text3');
    return renderView(session, message);
  } });
}

export async function handleChoice(
  services: SessionService,
  message: GamePlayer,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  return services.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.getById(sessionId);
    const locale = resolveLocale(session ? session.locale : message.locale);
    if (!session) return messages(locale, 'text4');
    if (session.player_id !== message.sender.id) return messages(locale, 'text5');

    if (session.status !== 'active' && choiceId !== 'restart') {
      return messages(locale, 'text6');
    }

    if (choiceId === 'restart') {
      await services.updateSession(session.id, { status: 'aborted' });
      return (await startGame(services, message)) ?? null;
    }
    if (choiceId === 'quit') {
      await services.updateSession(session.id, { status: 'aborted' });
      return renderView((await services.getById(session.id))!, message);
    }

    if (choiceId !== 'roll') return messages(locale, 'text7');

    const player = rollD6();
    const bot = rollD6();
    const result = compareRolls(player, bot);

    let playerWins = session.player_wins;
    let botWins = session.bot_wins;
    if (result === 1) playerWins++;
    if (result === 2) botWins++;

    let status: DiceSessionRow['status'] = 'active';
    if (playerWins >= WIN_TARGET) status = 'won';
    else if (botWins >= WIN_TARGET) status = 'lost';

    await services.updateSession(session.id, {
      player_wins: playerWins,
      bot_wins: botWins,
      round: session.round + 1,
      last_player_roll: player,
      last_bot_roll: bot,
      status,
    });

    const updated = (await services.getById(session.id))!;
    return renderView(updated, message, { player, bot, result });
  } });
}

export { DICE_PREFIX };

const messages = createMessages({
  text1: { 'zh-CN': "你已有进行中的骰子对决，请使用当前对局的操作入口。", en: "You already have an active dice duel. Continue using its controls." },
  text2: { 'zh-CN': "本频道 {p0} 正在掷骰对决中。", en: "{p0} is playing a dice duel in this channel." },
  text3: { 'zh-CN': "你没有进行中的骰子对决，请使用当前对局的操作入口。", en: "You have no active dice duel." },
  text4: { 'zh-CN': "对局不存在。", en: "This game no longer exists." },
  text5: { 'zh-CN': "这是别人的对局。", en: "This game belongs to another player." },
  text6: { 'zh-CN': "对局已结束，请点击再来一局。", en: "This game has ended. Choose Play again." },
  text7: { 'zh-CN': "无效操作。", en: "Invalid action." },
});
