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
  if (mine) {
    return buildGuessView(
      mine,
      ['你已有进行中的一局，请继续猜数字。'],
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
  if (!session) return null;

  const result = evaluateGuess(session.secret, value);
  if (result === 'invalid') {
    return `请输入 ${MIN} ~ ${MAX} 之间的整数。`;
  }

  const attempts = session.attempts + 1;

  if (result === 'win') {
    await services.updateSession(session.id, { attempts, status: 'won' });
    const updated = (await services.getById(session.id))!;
    return buildGuessView(
      updated,
      [`你用了 **${attempts}** 次。`],
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
    [hintText(result, rangeMin, rangeMax)],
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
  if (!session) return '这局已经不存在了，请重新开始。';
  if (session.channel_key
    !== `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`) {
    return '请回到开局的频道操作。';
  }
  if (session.player_id !== message.$sender.id) return '这是别人的猜数字对局。';

  if (choiceId === 'restart' && session.status !== 'active') {
    return startGame(services, message);
  }
  if (choiceId === 'quit' && session.status === 'active') {
    await services.updateSession(session.id, { status: 'aborted' });
    const updated = (await services.getById(session.id))!;
    return buildGuessView(updated, ['你放弃了本局。'], message.$channel.type);
  }
  return session.status === 'active'
    ? '请直接回复一个范围内的整数。'
    : buildGuessView(session, [], message.$channel.type);
}
