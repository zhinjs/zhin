import { createMessages, resolveLocale } from 'zhin.js/i18n';
import type { GameMessageLike, GameReply } from '@zhin.js/game-kit';
import { evaluateGuess, hintText, MAX, MIN } from './engine.js';
import type { SessionService } from './session-service.js';
import { buildGuessView } from './view.js';

export async function startGame(
  services: SessionService,
  message: GameMessageLike,
): Promise<GameReply> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const mine = await services.getActiveForUser(ch, message.$sender.id);
  const locale = resolveLocale(mine ? mine.locale : message.locale);
  if (mine) {
    return buildGuessView(
      mine,
      [messages(locale, 'text1')],
      message.$channel.type,
    );
  }
  const session = await services.createSession(message);
  return buildGuessView(session, [], message.$channel.type);
}

export async function processGuess(
  services: SessionService,
  message: GameMessageLike,
  value: number,
): Promise<GameReply | null> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const session = await services.getActiveForUser(ch, message.$sender.id);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return null;

  const result = evaluateGuess(session.secret, value);
  if (result === 'invalid') {
    return messages(locale, 'text2', { p0: MIN, p1: MAX });
  }

  const attempts = session.attempts + 1;

  if (result === 'win') {
    await services.updateSession(session.id, { attempts, status: 'won' });
    const updated = (await services.getById(session.id))!;
    return buildGuessView(
      updated,
      [messages(locale, 'text3', { p0: attempts })],
      message.$channel.type,
    );
  }

  if (attempts >= session.max_attempts) {
    await services.updateSession(session.id, { attempts, status: 'lost' });
    const updated = (await services.getById(session.id))!;
    return buildGuessView(updated, [], message.$channel.type);
  }

  let rangeMin = session.range_min;
  let rangeMax = session.range_max;
  if (result === 'low') rangeMin = Math.max(rangeMin, value + 1);
  else rangeMax = Math.min(rangeMax, value - 1);

  await services.updateSession(session.id, { attempts, range_min: rangeMin, range_max: rangeMax });

  const updated = (await services.getById(session.id))!;
  return buildGuessView(
    updated,
    [hintText(result, rangeMin, rangeMax, locale)],
    message.$channel.type,
  );
}

export async function handleGuessChoice(
  services: SessionService,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<GameReply> {
  const session = await services.getById(sessionId);
  const locale = resolveLocale(session ? session.locale : message.locale);
  if (!session) return messages(locale, 'text4');
  if (session.channel_key
    !== `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`) {
    return messages(locale, 'text5');
  }
  if (session.player_id !== message.$sender.id) return messages(locale, 'text6');

  if (choiceId === 'restart' && session.status !== 'active') {
    return startGame(services, message);
  }
  if (choiceId === 'quit' && session.status === 'active') {
    await services.updateSession(session.id, { status: 'aborted' });
    const updated = (await services.getById(session.id))!;
    return buildGuessView(updated, [messages(locale, 'text7')], message.$channel.type);
  }
  return session.status === 'active'
    ? messages(locale, 'text8')
    : buildGuessView(session, [], message.$channel.type);
}

const messages = createMessages({
  text1: { 'zh-CN': "你已有进行中的一局，请继续猜数字。", en: "You already have an active game. Keep guessing." },
  text2: { 'zh-CN': "请输入 {p0} ~ {p1} 之间的整数。", en: "Enter an integer between {p0} and {p1}." },
  text3: { 'zh-CN': "你用了 **{p0}** 次。", en: "You used **{p0}** guesses." },
  text4: { 'zh-CN': "这局已经不存在了，请重新开始。", en: "This game no longer exists. Please start again." },
  text5: { 'zh-CN': "请回到开局的频道操作。", en: "Return to the channel where this game started." },
  text6: { 'zh-CN': "这是别人的猜数字对局。", en: "This game belongs to another player." },
  text7: { 'zh-CN': "你放弃了本局。", en: "You quit this game." },
  text8: { 'zh-CN': "请直接回复一个范围内的整数。", en: "Reply with an integer in the range." },
});
