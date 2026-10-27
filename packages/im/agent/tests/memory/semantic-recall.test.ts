import { describe, expect, it } from 'vitest';
import { InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import { SemanticMemoryRuntime } from '../../src/plugin-runtime/native-semantic-memory-tools.js';
import { RECALL_HEADER, resolveRecallOptions } from '../../src/memory/semantic-recall.js';
import { handleRuntimeManagementCommand } from '../../src/init/runtime-management-commands.js';

const view = { sessionKey: 'im:qq:bot:group:g1', subjectId: 'alice', platform: 'qq' };
const signal = new AbortController().signal;

async function runtimeWith(entries: number, options?: ConstructorParameters<typeof SemanticMemoryRuntime>[0]) {
  const repository = new InMemoryMemoryEntryRepository();
  await repository.upsert({ scope: 'user', scope_key: 'alice', key: 'preference:drink', content: '喜欢喝乌龙茶' });
  for (let index = 0; index < entries; index += 1) {
    await repository.upsert({ scope: 'global', key: `note:${index}`, content: `茶话会记录第 ${index} 次，讨论了项目进度和茶点安排` });
  }
  const runtime = new SemanticMemoryRuntime(options);
  runtime.activate(repository);
  return { runtime, repository };
}

describe('semantic recall (#734)', () => {
  it('recalls the most relevant visible entry first', async () => {
    const { runtime } = await runtimeWith(3);
    const result = await runtime.recall(view, '我喜欢喝什么茶？', signal);
    expect(result?.text.split('\n')[0]).toBe(RECALL_HEADER);
    expect(result?.text.split('\n')[1]).toContain('preference:drink: 喜欢喝乌龙茶');
  });

  it('keeps recall cost bounded as the store grows', async () => {
    const small = await (await runtimeWith(10)).runtime.recall(view, '茶话会 茶', signal);
    const large = await (await runtimeWith(1000)).runtime.recall(view, '茶话会 茶', signal);
    const { maxTokens, topK } = resolveRecallOptions(undefined);
    expect(large!.entries.length).toBeLessThanOrEqual(topK);
    expect(large!.tokens).toBeLessThanOrEqual(maxTokens);
    expect(large!.tokens).toBeLessThanOrEqual(small!.tokens * 1.5);
  });

  it('respects topK and maxTokens', async () => {
    const { runtime } = await runtimeWith(50, { recall: { topK: 2, maxTokens: 1000 } });
    expect((await runtime.recall(view, '茶话会', signal))!.entries).toHaveLength(2);
    const tight = await (await runtimeWith(50, { recall: { maxTokens: 40 } })).runtime.recall(view, '茶话会', signal);
    expect(tight?.tokens ?? 0).toBeLessThanOrEqual(40);
  });

  it('never recalls other users, expired, or deleted entries, and can be disabled', async () => {
    const { runtime, repository } = await runtimeWith(0);
    await repository.upsert({ scope: 'user', scope_key: 'bob', key: 'secret', content: '乌龙茶秘方' });
    const stale = await repository.upsert({ scope: 'session', scope_key: view.sessionKey, key: 'task', content: '乌龙茶订单处理中', kind: 'task_state', expires_at: Date.now() - 1 });
    const text = (await runtime.recall(view, '乌龙茶', signal))!.text;
    expect(text).not.toContain('秘方');
    expect(text).not.toContain(stale.content);

    const [own] = await repository.list({ scope: 'user', scope_key: 'alice' });
    await runtime.delete(own!.id, signal);
    expect(await runtime.recall(view, '乌龙茶', signal)).toBeNull();

    const disabled = await runtimeWith(3, { recall: { enabled: false } });
    expect(await disabled.runtime.recall(view, '乌龙茶', signal)).toBeNull();
  });

  it('records last_used_at for recalled entries', async () => {
    const { runtime, repository } = await runtimeWith(0);
    await runtime.recall(view, '乌龙茶', signal);
    const [own] = await repository.list({ scope: 'user', scope_key: 'alice' });
    expect(own?.last_used_at).toBeTypeOf('number');
  });
});

describe('/memory and /forget', () => {
  const base = {
    commandPrefix: '/',
    service: {} as never,
    zhinAgent: {} as never,
    sessionKey: 'im:qq:bot:private:alice',
    senderRoles: { isMaster: false, isTrusted: false },
    senderId: 'alice',
  };

  it('lists and forgets only the sender\'s own memory', async () => {
    const { runtime, repository } = await runtimeWith(2);
    await repository.upsert({ scope: 'user', scope_key: 'alice', key: 'pet', content: '橘猫团子' });
    await repository.upsert({ scope: 'user', scope_key: 'bob', key: 'pet', content: 'bob 的狗' });
    const run = (content: string) => handleRuntimeManagementCommand({ ...base, content, semanticMemory: runtime });

    const listed = await run('/memory');
    expect(listed).toContain('关于你的记忆（2 条）');
    expect(listed).toContain('橘猫团子');
    expect(listed).not.toContain('bob');
    expect(listed).not.toContain('茶话会');

    expect(await run('/forget pet')).toContain('已遗忘 1 条');
    expect(await repository.find({ scope: 'user', scope_key: 'bob', key: 'pet' })).not.toBeNull();
    expect(await run('/forget all')).toContain('已遗忘 1 条');
    expect(await run('/memory')).toContain('没有关于你的记忆');
    expect(await run('/forget nothing')).toContain('没有找到');
  });

  it('passes through when semantic memory is not active', async () => {
    expect(await handleRuntimeManagementCommand({ ...base, content: '/memory' })).toBeNull();
  });
});
