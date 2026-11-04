import { createMessages } from 'zhin.js/i18n';
import { formatGameHelp, gameCommandHint, gameCommandFeedback, channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import { formatPlayerWithMark, formatRosterLine } from './player-label.js';
import { startBotGame, startPvpGame } from './game-flow.js';
import type { SessionServices } from './session-service.js';

export function getTttHelp(message: Pick<GamePlayer, 'locale' | 'formatCommand'> = {}): string {
  return formatGameHelp({ presentation: message, title: { 'zh-CN': '井字棋', en: 'Tic-Tac-Toe' }, commandPath: 'ttt', actions: ['bot', 'join', 'leave', 'quit', 'spectate'], footer: { 'zh-CN': '群聊排队满 2 人自动开局；私聊可选择人机对战。', en: 'The group queue starts a match when two players join. In private chats, play against the bot.' } });
}
export const TTT_HELP = getTttHelp();

export async function runTttCommand(
  services: SessionServices,
  message: GamePlayer,
  action: string,
): Promise<GameReply> {
  return services.session.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const userId = message.sender.id;

    if (!action || action === 'help') {
      const active = await services.session.getActiveByChannel(ch);
      const q = await services.queue.count(ch);
      const lines = [getTttHelp(message), ''];
      if (active) lines.push(messages(message.locale, 'text1', { p0: formatRosterLine(active) }));
      if (q > 0) lines.push(messages(message.locale, 'text2', { p0: q }));
      if (!active && q === 0) lines.push(gameCommandFeedback(message, 'noGame'), gameCommandHint(message, 'ttt', 'bot'));
      return lines.join('\n');
    }

    if (action === 'join') {
      if (message.target.kind === 'private') {
        return gameCommandHint(message, 'ttt', 'bot') || getTttHelp(message);
      }
      const inGame = await services.session.getActiveForUser(ch, userId);
      if (inGame) return messages(message.locale, 'text3');
      const { position } = await services.queue.join(ch, userId, message.sender.name);
      const pair = await services.queue.tryMatch(ch);
      if (pair) {
        const [px, po] = pair;
        const board = await startPvpGame(services, message, px, po);
        const matchLine = messages(message.locale, 'text4', { p0: formatPlayerWithMark(px.id, px.displayName, '✕'), p1: formatPlayerWithMark(po.id, po.displayName, '○') });
        return board
          ? Array.isArray(board)
            ? [matchLine, '\n\n', ...board]
            : [matchLine, '\n\n', board]
          : matchLine;
      }
      return messages(message.locale, 'text5', { p0: position });
    }

    if (action === 'leave') {
      const ok = await services.queue.leave(ch, userId);
      return ok ? messages(message.locale, 'text6') : messages(message.locale, 'text7');
    }

    if (action === 'bot') {
      return startBotGame(services, message);
    }

    if (action === 'quit') {
      const row = await services.session.getActiveForUser(ch, userId);
      if (!row) return messages(message.locale, 'text8');
      await services.session.updateSession(row.id, { status: 'aborted', winner: 0 });
      return messages(row.locale ?? undefined, 'text9');
    }

    if (action === 'spectate') {
      const active = await services.session.getActiveByChannel(ch);
      if (!active) return messages(message.locale, 'text10');
      await services.session.addSpectator(active.id, userId);
      return messages(message.locale, 'text11', { p0: active.id });
    }

    return gameCommandFeedback(message, 'unknown', action) + '\n\n' + getTttHelp(message);
  } });
}

const messages = createMessages({
  text1: { 'zh-CN': "进行中：{p0}", en: "Playing: {p0}" },
  text2: { 'zh-CN': "排队：{p0} 人", en: "Queue: {p0} players" },
  text3: { 'zh-CN': "你已在进行中的对局里。", en: "You are already playing a game." },
  text4: { 'zh-CN': "匹配成功！{p0} vs {p1}", en: "Match found! {p0} vs {p1}" },
  text5: { 'zh-CN': "已加入排队（第 {p0} 位），凑满 2 人自动开局。", en: "Joined the queue (position {p0}). The game starts when two players join." },
  text6: { 'zh-CN': "已离开排队。", en: "You left the queue." },
  text7: { 'zh-CN': "你不在排队中。", en: "You are not in the queue." },
  text8: { 'zh-CN': "你没有进行中的对局。", en: "You have no active game." },
  text9: { 'zh-CN': "你已认输，对局结束。", en: "You conceded. The game has ended." },
  text10: { 'zh-CN': "当前频道没有进行中的对局。", en: "There is no active game in this channel." },
  text11: { 'zh-CN': "已订阅观战（局 {p0}）。每步会在频道更新棋盘。", en: "Spectating game {p0}. The board updates in this channel after every move." },
});
