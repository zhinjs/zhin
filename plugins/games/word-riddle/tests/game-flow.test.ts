import { beforeEach, describe, expect, it } from 'vitest';
import {
  channelKey,
  createMemoryGameServices,
  plainTextFromSendContent,
} from '@zhin.js/game-kit';
import { handleChoice, processAnswerText, startGame } from '../src/game-flow.js';
import { cleanRiddleText, riddlesByType } from '../src/riddle-provider.js';
import { getRiddleById } from '../src/engine.js';
import { createServices, currentRiddleId, type SessionService } from '../src/session-service.js';

describe('word-riddle game-flow (plugin=null)', () => {
  let services: SessionService;

  beforeEach(() => {
    services = createMemoryGameServices(['word_riddle_sessions'], createServices);
  });

  it('processAnswerText returns text when guessing wrong with null plugin', async () => {
    const message = smokeGameMessage();
    await startGame(services, message as never, 'char');

    const reply = await processAnswerText(services, message as never, '错误答案');

    expect(reply).toBeTruthy();
    expect(typeof reply).toBe('string');
    expect(reply).toMatch(/不对|猜谜|不算失误/);
  });

  it('格式不合规（字数不符）只提示不扣失误', async () => {
    const message = smokeGameMessage();
    await startGame(services, message as never, 'char');
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.sender.id))!;

    const reply = await processAnswerText(services, message as never, '好的');

    expect(reply).toMatch(/不算失误/);
    const after = (await services.getById(before.id))!;
    expect(after.wrong_count).toBe(0);
    expect(after.status).toBe('active');
  });

  it('格式合规但答错仍计一次失误', async () => {
    const message = smokeGameMessage();
    await startGame(services, message as never, 'char');
    const ch = channelKey(message as never);
    const before = (await services.getActiveForUser(ch, message.sender.id))!;
    const entry = getRiddleById(currentRiddleId(before)!)!;
    const wrongChar = entry.answer === '龘' ? '错' : '龘';

    const reply = await processAnswerText(services, message as never, wrongChar);

    expect(plainTextFromSendContent(reply!)).toMatch(/不对/);
    const after = (await services.getById(before.id))!;
    expect(after.wrong_count).toBe(1);
  });
});

describe('word-riddle hint, quit and question bank (#1250)', () => {
  let services: SessionService;
  beforeEach(() => { services = createMemoryGameServices(['word_riddle_sessions'], createServices); });

  async function active(mode: 'char' | 'idiom') {
    const message = smokeGameMessage();
    await startGame(services, message as never, mode);
    const session = (await services.getActiveForUser(channelKey(message as never), message.sender.id))!;
    return { message, session, entry: getRiddleById(currentRiddleId(session)!)! };
  }

  it('an idiom hint reveals the first character and keeps the streak', async () => {
    const { message, session, entry } = await active('idiom');
    await services.updateSession(session.id, { streak: 2, score: 20 });
    const text = plainTextFromSendContent((await handleChoice(services, message as never, session.id, 'hint'))!);
    expect(text).toContain(`第 1 个字是「${[...entry.answer][0]}」`);
    const after = (await services.getById(session.id))!;
    expect(after.streak).toBe(2);
    expect(after.score).toBe(17);
  });

  it('a character-riddle hint lists candidates that include the answer', async () => {
    const { message, session, entry } = await active('char');
    const text = plainTextFromSendContent((await handleChoice(services, message as never, session.id, 'hint'))!);
    expect(text).toMatch(/答案是这几个字之一：/);
    expect(text).toContain(entry.answer);
  });

  it('quit reveals the current answer and sums up the round', async () => {
    const { message, session, entry } = await active('idiom');
    const text = String(await handleChoice(services, message as never, session.id, 'quit'));
    expect(text).toContain(`本题答案：**${entry.answer}**`);
    expect(text).toMatch(/本局成绩：已答 0\/\d+ 题 · 得分 \*\*0\*\*/);
    expect((await services.getById(session.id))!.status).toBe('aborted');
  });

  it('the question bank has no repeated punctuation', () => {
    expect(cleanRiddleText('只有一条路可以活下去。。')).toBe('只有一条路可以活下去。');
    expect(cleanRiddleText('真的吗？？')).toBe('真的吗？');
    const repeated = /([。．！？，、；：…!?,;:])\1/u;
    expect(riddlesByType('idiom').filter(entry => repeated.test(entry.question))).toEqual([]);
    expect(riddlesByType('char').filter(entry => repeated.test(entry.question))).toEqual([]);
  });
});

function smokeGameMessage() { return { locale: 'zh-CN' as const, target: { endpoint: { adapter: 'synthetic', id: 'canonical-test' }, kind: 'private' as const, id: 'alice' }, sender: { id: 'alice', name: 'Alice' } }; }
