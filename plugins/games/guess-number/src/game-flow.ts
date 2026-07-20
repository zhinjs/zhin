import type { Message } from 'zhin.js';
import { recordGameOutcome } from '@zhin.js/game-kit';
import { evaluateGuess, hintText, MAX, MIN } from './engine.js';
import { formatStatus, type SessionService } from './session-service.js';

export async function startGame(
  services: SessionService,
  message: Message<any>,
): Promise<string> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const mine = await services.getActiveForUser(ch, message.$sender.id);
  if (mine) {
    return `${formatStatus(mine)}\n\n（你已有进行中的局，继续猜数字，或发送「猜数 放弃」）`;
  }
  const session = await services.createSession(message);
  return formatStatus(session);
}

export async function processGuess(
  services: SessionService,
  message: Message<any>,
  value: number,
): Promise<string | null> {
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
    void recordGameOutcome(message, 'guess', 'won', Math.max(1, session.max_attempts - attempts + 1) * 10);
    return [
      '🎉 **猜对了！**',
      '',
      `答案就是 **${session.secret}**，你用了 ${attempts} 次。`,
      '发送 `/猜数 开始` 再来一局。',
    ].join('\n');
  }

  if (attempts >= session.max_attempts) {
    await services.updateSession(session.id, { attempts, status: 'lost' });
    void recordGameOutcome(message, 'guess', 'lost');
    return [
      '💀 **机会用完了！**',
      '',
      `正确答案是 **${session.secret}**。`,
      '发送 `/猜数 开始` 再来一局。',
    ].join('\n');
  }

  let rangeMin = session.range_min;
  let rangeMax = session.range_max;
  if (result === 'low') rangeMin = Math.max(rangeMin, value + 1);
  else rangeMax = Math.min(rangeMax, value - 1);

  await services.updateSession(session.id, { attempts, range_min: rangeMin, range_max: rangeMax });

  const left = session.max_attempts - attempts;
  return [
    hintText(result, rangeMin, rangeMax),
    '',
    `剩余 **${left}** 次机会，继续猜吧！`,
  ].join('\n');
}
