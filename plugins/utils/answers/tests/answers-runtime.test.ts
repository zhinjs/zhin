import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { childPluginId, definePlugin, rootPluginId } from '../../../../packages/im/plugin-runtime/src/index.js';
import commandFeature, { commandFeatureId, CommandIndex, parseCommandDefinition, type CommandMessage } from '../../../../packages/im/command/src/index.js';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import { RootRuntime, type ModuleRuntime } from '../../../../packages/im/runtime/src/index.js';
import plugin from '../plugin.js';
import configSchema from '../schema.json' with { type: 'json' };
import bookCommand from '../commands/答案之书/index.js';
import boringCommand from '../commands/好无聊/index.js';
import drivingCommand from '../commands/科目一/index.js';
import quizAnswer from '../middlewares/quiz-answer/index.js';
import { BOOK_ANSWERS } from '../src/book-data.js';
import { DRIVING_QUESTIONS } from '../src/driving-quiz-data.js';
import { FUN_QUESTIONS } from '../src/fun-quiz-data.js';
import { quizServiceToken } from '../src/runtime.js';
import type { QuizService } from '../src/quiz.js';

const conversation = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'group', id: 'room' } as const;
const alice: CommandMessage = { conversation, sender: { id: 'alice' }, content: '' };
const bob: CommandMessage = { conversation, sender: { id: 'bob' }, content: '' };
const temporary: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

async function fixture(settings: Record<string, unknown> = {}) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-answers-'))); temporary.push(project);
  const modules = new Map<string, unknown>();
  const write = async (relative: string, value: unknown, module = false) => {
    const path = join(project, relative); await mkdir(dirname(path), { recursive: true }); await writeFile(path, module ? '' : JSON.stringify(value)); if (module) modules.set(path, value);
  };
  const features = [{ package: '@test/command' }];
  await write('package.json', { name: '@test/root', dependencies: { '@test/answers': '*', '@test/command': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features, plugins: [] } });
  await write('plugin.ts', { default: definePlugin({ name: 'root' }) }, true);
  await write('packages/command/package.json', { name: '@test/command', zhin: { protocol: 1, type: 'feature', entry: './index.ts' } });
  await write('packages/command/index.ts', { default: commandFeature }, true);
  await write('plugins/answers/package.json', { name: '@test/answers', dependencies: { '@test/command': '*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', features } });
  await write('plugins/answers/plugin.ts', { default: plugin }, true);
  await write('plugins/answers/schema.json', configSchema);
  for (const [name, value] of Object.entries({ '答案之书': bookCommand, '好无聊': boringCommand, '科目一': drivingCommand })) {
    await write(`plugins/answers/commands/${name}/index.ts`, { default: value }, true);
  }
  const loader: ModuleRuntime = { async load<T>(source: string): Promise<T> { if (!modules.has(source)) throw new Error(`Missing fixture module ${source}`); return modules.get(source) as T; }, async close() {} };
  const runtime = new RootRuntime({ projectRoot: project, modules: loader,
    config: { configVersion: 2, plugins: { answers: '@test/answers' }, answers: { ...settings } },
    environment: { name: 'test', mode: 'test', platform: 'node' } });
  const command = async (text: string, source = alice, prefix = ''): Promise<unknown> => {
    const index = runtime.snapshot.projections.get(commandFeatureId); if (!(index instanceof CommandIndex)) throw new Error('Missing CommandIndex');
    const result = await index.dispatch({ input: text, source: { ...source, content: text }, commandPrefix: prefix }); return result.status === 'executed' ? result.value : result;
  };
  const service = (): QuizService => runtime.snapshot.resources.get(childPluginId(rootPluginId(), 'answers'))!.get(quizServiceToken.id) as QuizService;
  /** Drive the inbound middleware with the owner-scoped service, mirroring Runtime's `context.use`. */
  const reply = async (text: string, source = alice) => {
    const replies: unknown[] = []; const next = vi.fn(async () => undefined);
    const input = { ...source, content: text, $reply: async (content: unknown) => { replies.push(content); return 'id'; } };
    const context = { input, config: {}, use: (token: { id: string }) => { if (token.id !== quizServiceToken.id) throw new Error('unexpected token'); return service(); } };
    await (quizAnswer as unknown as { handle(context: unknown, next: () => Promise<void>): Promise<void> }).handle(context, next);
    return { replies, passed: next.mock.calls.length > 0 };
  };
  return { runtime, command, service, reply };
}

describe('@zhin.js/plugin-answers through real Runtime discovery', () => {
  it('brands every capability', () => {
    expect(plugin.name).toBe('answers');
    for (const definition of [bookCommand, boringCommand, drivingCommand]) expect(parseCommandDefinition(definition)).toBe(definition);
    expect(parseMiddlewareDefinition(quizAnswer)).toBe(quizAnswer);
  });

  it('answers the book question and shows usage without one', async () => {
    const f = await fixture();
    await f.runtime.start();
    try {
      expect(String(await f.command('答案之书'))).toContain('用法：答案之书 <问题>');
      const value = String(await f.command('答案之书 今天 要不要 出去走走'));
      expect(value).toContain('你问：今天 要不要 出去走走');
      expect(BOOK_ANSWERS.some(answer => value.endsWith(answer))).toBe(true);
    } finally { await f.runtime.stop(); }
  });

  it('keeps answers stable for the day when dailyStable is configured', async () => {
    const f = await fixture({ dailyStable: true, timezone: 'UTC' });
    await f.runtime.start();
    try {
      const answerOf = async (text: string) => String(await f.command(text)).split('\n').pop();
      const first = await answerOf('答案之书 明天会下雨吗');
      for (let i = 0; i < 5; i++) expect(await answerOf('答案之书 明天会下雨吗？')).toBe(first);
    } finally { await f.runtime.stop(); }
  });

  it('asks a fun question that only the asker can answer, exactly once', async () => {
    const f = await fixture();
    await f.runtime.start();
    try {
      const prompt = String(await f.command('好无聊'));
      expect(prompt).toContain('好无聊？请听题！');
      const question = FUN_QUESTIONS.find(item => prompt.includes(item.question))!;
      expect(question).toBeDefined();
      expect(await f.reply(question.answer, bob)).toEqual({ replies: [], passed: true });
      expect(await f.reply('随便聊聊')).toEqual({ replies: [], passed: true });
      const answered = await f.reply(question.answer.toLowerCase());
      expect(answered.passed).toBe(false);
      expect(String(answered.replies[0])).toContain('✅ 答对了');
      expect(await f.reply(question.answer)).toEqual({ replies: [], passed: true });
    } finally { await f.runtime.stop(); }
  });

  it('marks wrong driving answers with the correct option and a disclaimer', async () => {
    const f = await fixture();
    await f.runtime.start();
    try {
      const prompt = String(await f.command('科目一'));
      const question = DRIVING_QUESTIONS.find(item => prompt.includes(item.question))!;
      const wrong = (['A', 'B', 'C', 'D'] as const).slice(0, question.options.length).find(letter => letter !== question.answer)!;
      const { replies } = await f.reply(wrong);
      expect(String(replies[0])).toContain(`正确答案是 ${question.answer}.`);
      expect(String(replies[0])).toContain('仅供娱乐参考');
    } finally { await f.runtime.stop(); }
  });

  it('expires unanswered questions after the configured timeout', async () => {
    const f = await fixture({ quizTimeoutSeconds: 15 });
    await f.runtime.start();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    try {
      const prompt = String(await f.command('好无聊'));
      expect(prompt).toContain('15 秒内有效');
      const question = FUN_QUESTIONS.find(item => prompt.includes(item.question))!;
      clock.mockReturnValue(1_800_000_016_000);
      expect(await f.reply(question.answer)).toEqual({ replies: [], passed: true });
    } finally { await f.runtime.stop(); }
  });

  it('can disable the driving quiz and refuses anonymous sessions', async () => {
    const f = await fixture({ enableDrivingQuiz: false });
    await f.runtime.start();
    try {
      expect(String(await f.command('科目一'))).toContain('未启用');
      expect(String(await f.command('好无聊', { conversation, content: '' } as CommandMessage))).toContain('真实会话');
    } finally { await f.runtime.stop(); }
  });

  it('disposes pending questions when the generation stops', async () => {
    const f = await fixture();
    await f.runtime.start();
    await f.command('好无聊');
    const service = f.service();
    expect(service.size).toBe(1);
    await f.runtime.stop();
    expect(service.size).toBe(0);
  });
});


it('pins quiz feedback to the asking language and renders actual command prefixes', async () => {
  const f = await fixture();
  await f.runtime.start();
  try {
    const english: CommandMessage = { ...alice, locale: 'en' };
    const prompt = String(await f.command('boring', english));
    expect(prompt).toContain('Chinese question bank');
    const question = FUN_QUESTIONS.find(item => prompt.includes(item.question))!;
    expect(question).toBeDefined();
    const answered = await f.reply(question.answer, { ...alice, locale: 'zh-CN' });
    expect(String(answered.replies[0])).toContain('Correct!');
    expect(String(answered.replies[0])).toContain(question.explanation);
    expect(String(await f.command('答案之书', english, '!!'))).toContain('!!answerbook <question>');
  } finally { await f.runtime.stop(); }
});
