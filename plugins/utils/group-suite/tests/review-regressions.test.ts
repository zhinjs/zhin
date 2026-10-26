import checkinCommand from '../commands/checkin/index.ts';
import myPointsCommand from '../commands/mypoints/index.ts';
import teachCommand from '../commands/teach/index.ts';
import { tryTeachReply } from '../src/teach-lib.js';
import { PluginDatabaseHost, rootPluginId } from 'zhin.js';
import { keywords, KEYWORD_STORAGE_REQUIREMENT } from '../src/keywords.js';
import { createGroupSuiteRuntime, groupSuiteRuntimeToken } from '../src/runtime-state.js';
import { createInMemoryGroupSuiteDb } from '../src/memory-store.js';
import { resolveGroupSuiteConfig } from '../src/config.js';
import { doCheckin, pointsRank } from '../src/checkin-lib.js';
import { recordMessage, flushStatsBuffer } from '../src/stats-lib.js';
import { toolGroupConversation } from '../src/conversation-scope.js';
import keywordAdd from '../commands/keyword-add/[keyword]/index.ts';
import keywordList from '../commands/keyword-list/index.ts';
import keywordRemove from '../commands/keyword-remove/[keyword]/index.ts';
import statsCard from '../commands/stats-card/index.ts';
import checkinQuery from '../skills/checkin/tools/checkin_query/index.ts';
import statsQuery from '../skills/group-daily-analysis/tools/stats_query/index.ts';

const input = { conversation: { kind: 'group' as const, id: 'g1', endpoint: { adapter: 'test', id: 'bot' } }, sender: { id: 'u1', name: 'Alice' } };
const project = () => ({ describe: () => [{ id: 'bot', name: 'memory' }], clientAdapter: () => 'test' });

it('default no-DB management commands report a concrete requirement, not empty state or success', async () => {
  const context = { config: resolveGroupSuiteConfig({}), input, params: { keyword: 'hi' }, args: ['hello'], use: () => { throw new Error('Missing resource'); } };
  for (const command of [keywordAdd, keywordList, keywordRemove]) {
    expect(await command.execute(context as never)).toBe(KEYWORD_STORAGE_REQUIREMENT);
  }
});

it('management works with a persistent Database Host while automatic replies are disabled', async () => {
  let revision = 0;
  const rows = new Map<string, { revision: string; value: unknown; expiresAt: number | null }>();
  const keyOf = (owner: string, scope: unknown, key: string) => JSON.stringify([owner, scope, key]);
  const host = new PluginDatabaseHost(rootPluginId(), { state: {
    async read(owner: string, scope: unknown, key: string) { return rows.get(keyOf(owner, scope, key)); },
    async compareExchange(owner: string, scope: unknown, key: string, expected: string | undefined, value: unknown, expiresAt: number | null) {
      const keyId = keyOf(owner, scope, key);
      if (rows.get(keyId)?.revision !== expected) return false;
      rows.set(keyId, { revision: String(++revision), value: structuredClone(value), expiresAt }); return true;
    },
  } } as never);
  const context = { config: resolveGroupSuiteConfig({}), input, params: { keyword: 'hi' }, args: ['hello'], use: () => host };
  expect(await keywordAdd.execute(context as never)).toContain('已添加');
  expect(await keywordList.execute(context as never)).toContain('hello');
  expect(rows.size).toBe(1);
});

it.each(['ephemeral', 'persistent'])('rejects an oversized UTF-8 dictionary atomically (%s)', async mode => {
  const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  let committed: unknown;
  const context = { config: { ephemeralKeywords: mode === 'ephemeral' }, use: (token: unknown) => token === groupSuiteRuntimeToken ? runtime : {
    state: { forConversation: () => ({ update: async (updateKey: string, updater: (value: unknown) => unknown) => { committed = updater(committed); }, get: async () => committed }) },
  } };
  const repository = keywords(input, context as never);
  const reply = '😀'.repeat(500);
  await repository.update(store => { for (let i = 0; i < 32; i++) store.set(`k${i}`, reply); });
  expect(await repository.read()).toHaveLength(32);
  await expect(repository.update(store => { store.set('overflow', reply); })).rejects.toThrow('小于 64 KiB');
  expect(await repository.read()).toHaveLength(32);
});

it('preserves the current thread for query tools and does not transplant it to another group', async () => {
  const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  const config = resolveGroupSuiteConfig({});
  const thread = { ...input, conversation: { ...input.conversation, threadId: 'thread-one' } };
  const other = { ...input, conversation: { ...input.conversation, threadId: 'thread-two' }, sender: { id: 'u2', name: 'Bob' } };
  await doCheckin(thread, config, runtime); await doCheckin(other, config, runtime);
  recordMessage(thread, runtime); recordMessage(other, runtime); recordMessage(other, runtime);
  await flushStatsBuffer(runtime);
  const context = { origin: { kind: 'im' as const, platform: 'test', endpoint: 'memory', scope: 'group' as const, sceneId: 'g1', threadId: 'thread-one' }, project, use: () => runtime };
  expect(toolGroupConversation(context as never).threadId).toBe('thread-one');
  expect(toolGroupConversation(context as never, 'g1').threadId).toBe('thread-one');
  expect(toolGroupConversation(context as never, 'g2').threadId).toBeUndefined();
  const checkin = await checkinQuery.execute({ user_id: 'u1' }, context as never);
  expect(checkin).toContain('Alice');
  const stats = await statsQuery.execute({}, context as never);
  expect(stats).toContain('总消息: 1条'); expect(stats).not.toContain('Bob');
});

it.each(['private', 'channel'] as const)('labels %s rankings as their actual conversation scope', async kind => {
  const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  const scene = { ...input, conversation: { ...input.conversation, kind } };
  const config = resolveGroupSuiteConfig({}); await doCheckin(scene, config, runtime);
  const report = await pointsRank(scene, config, runtime);
  expect(report).toContain(kind === 'private' ? '当前私聊积分排行' : '本频道积分排行');
  expect(report).not.toContain('全局');
});

it('statistics card resolves metadata-only sender identity exactly like text reports', async () => {
  const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  const metadataInput = { conversation: input.conversation, metadata: { senderId: 'u1', senderName: 'Alice' } };
  recordMessage(metadataInput, runtime);
  const reply = await statsCard.execute({ input: metadataInput, config: resolveGroupSuiteConfig({}), use: () => runtime } as never);
  expect(reply).toMatchObject({ type: 'html' });
  expect((reply as { data: { html: string } }).data.html).toContain('我的排名');
});


it('localizes commands, their real command hint, tools and HTML without translating user content', async () => {
  const runtime = createGroupSuiteRuntime(createInMemoryGroupSuiteDb());
  const context = { input, locale: 'en', config: resolveGroupSuiteConfig({ ephemeralKeywords: true }),
    params: {}, args: [], use: () => runtime, formatCommand: (path: string) => path === 'checkin' ? '!ops checkin' : undefined };
  expect(await myPointsCommand.execute(context as never)).toContain('!ops checkin');
  expect(await myPointsCommand.execute({ ...context, formatCommand: () => undefined } as never)).not.toContain('“checkin”');
  expect(await checkinCommand.execute(context as never)).toContain('Checked in!');
  expect(await myPointsCommand.execute(context as never)).toContain('Checked in today');
  expect(await teachCommand.execute({ ...context, args: ['你好|您好，这是用户内容'] } as never)).toContain('Learned!');
  expect(await tryTeachReply({ ...input, locale: 'en', content: '你好' }, context.config, runtime)).toBe('您好，这是用户内容');
  expect(await keywordAdd.execute({ ...context, params: { keyword: '中文' }, args: ['保留原文'] } as never)).toContain('Keyword added: “中文” → “保留原文”');
  expect(await keywordList.execute(context as never)).toContain('Keywords (1)');
  recordMessage(input, runtime); await flushStatsBuffer(runtime);
  const card = await statsCard.execute(context as never);
  expect(JSON.stringify(card)).toContain("Today&#39;s group message statistics");
  expect(JSON.stringify(card)).toContain('Participants');
  expect(JSON.stringify(card)).not.toContain('排行榜');
  const tool = { ...context, project, origin: { kind: 'im', platform: 'test', endpoint: 'memory', scope: 'group', sceneId: 'g1' } };
  expect(await checkinQuery.execute({ user_id: 'u1' }, tool as never)).toContain('check-ins=1 days');
  expect(await statsQuery.execute({}, tool as never)).toContain('Messages: 1');
});
