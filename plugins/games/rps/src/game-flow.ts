import { createMessages, resolveLocale } from 'zhin.js/i18n';
import type { GameMessageLike, GameReply } from '@zhin.js/game-kit';
import type { RpsSessionRow } from './models.js';
import {
  RPS_PREFIX,
  WIN_TARGET,
  randomBotMove,
  resolveRound,
  type RpsMove,
} from './engine.js';
import type { SessionService } from './session-service.js';
import { buildRpsView } from './view.js';

/**
 * Plugin Runtime: render the board as text. Interactive in-place board editing
 * (the old Adapter.editMessage path) is not part of the runtime flow; commands
 * and the choice middleware return fresh text each turn.
 */
function renderView(
  session: RpsSessionRow,
  message: GameMessageLike,
  lastRound?: { player: RpsMove; bot: RpsMove; result: 0 | 1 | 2 },
): GameReply {
  return buildRpsView(session, lastRound, message.$channel.type);
}

export async function startGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<GameReply | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.getActiveByChannel(ch);
  const locale = resolveLocale(active ? active.locale : message.locale);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return messages(locale, 'text1');
    }
    return messages(locale, 'text2', { p0: active.player_name });
  }
  const session = await services.createSession(message);
  return renderView(session, message);
}

export async function handleChoice(
  services: SessionService,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  const session = await services.getById(sessionId);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return messages(locale, 'text3');
  if (session.status !== 'active' && choiceId !== 'restart') {
    return messages(locale, 'text4');
  }
  if (session.player_id !== message.$sender.id) return messages(locale, 'text5');

  if (choiceId === 'restart') {
    await services.updateSession(session.id, { status: 'aborted' });
    return (await startGame(services, message)) ?? null;
  }
  if (choiceId === 'quit') {
    await services.updateSession(session.id, { status: 'aborted' });
    return renderView((await services.getById(session.id))!, message);
  }

  const player = choiceId as RpsMove;
  if (!['rock', 'paper', 'scissors'].includes(player)) return messages(locale, 'text6');

  const bot = randomBotMove();
  const result = resolveRound(player, bot);
  let playerWins = session.player_wins;
  let botWins = session.bot_wins;
  if (result === 1) playerWins++;
  if (result === 2) botWins++;

  let status: RpsSessionRow['status'] = 'active';
  if (playerWins >= WIN_TARGET) status = 'won';
  else if (botWins >= WIN_TARGET) status = 'lost';

  await services.updateSession(session.id, {
    player_wins: playerWins,
    bot_wins: botWins,
    round: session.round + 1,
    status,
  });

  const updated = (await services.getById(session.id))!;
  return renderView(updated, message, { player, bot, result });
}

export async function continueGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<GameReply> {
  const session = await services.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return messages(locale, 'text7');
  return renderView(session, message);
}

export { RPS_PREFIX };

const messages = createMessages({
  text1: { 'zh-CN': "你已有进行中的猜拳，请使用当前对局的操作入口。", en: "You already have an active game. Continue using its controls." },
  text2: { 'zh-CN': "本频道 {p0} 正在猜拳对决中。", en: "{p0} is playing rock, paper, scissors in this channel." },
  text3: { 'zh-CN': "对局不存在。", en: "This game no longer exists." },
  text4: { 'zh-CN': "对局已结束，请点击再来一局。", en: "This game has ended. Choose Play again." },
  text5: { 'zh-CN': "这是别人的对局。", en: "This game belongs to another player." },
  text6: { 'zh-CN': "无效出拳。", en: "Invalid move." },
  text7: { 'zh-CN': "你没有进行中的猜拳，请使用当前对局的操作入口。", en: "You have no active rock, paper, scissors game." },
});
