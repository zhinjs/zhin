import { describe, expect, it } from 'vitest';
import { InMemoryMemoryEntryRepository } from '@zhin.js/ai';
import type { ToolExecutionContext } from '@zhin.js/tool';
import {
  createNativeSemanticMemoryToolFeatures,
  SemanticMemoryRuntime,
} from '../../src/plugin-runtime/native-semantic-memory-tools.js';

const context = Object.freeze({
  signal: new AbortController().signal,
  traceId: 'trace-1',
  turnId: 'turn-1',
  sessionKey: 'session-1',
  origin: Object.freeze({
    kind: 'im' as const,
    platform: 'telegram',
    endpoint: 'main',
    scope: 'group' as const,
    sceneId: 'group-1',
  }),
  principal: Object.freeze({ subjectId: 'user-1', roles: Object.freeze(['user']) }),
  policy: Object.freeze({
    permissions: Object.freeze([]),
    unattended: false,
    network: Object.freeze({ enabled: false }),
  }),
  use: () => { throw new Error('No capability dependencies'); },
  tryUse: () => undefined,
  has: () => false,
  config: Object.freeze({}),
  owner: 'root',
}) as unknown as ToolExecutionContext;

describe('native semantic-memory tools', () => {
  it('fails closed until the candidate database activation succeeds', async () => {
    const runtime = new SemanticMemoryRuntime();
    const search = createNativeSemanticMemoryToolFeatures(runtime)
      .find((tool) => tool.name === 'memory_search')!;

    await expect(search.definition.execute({ query: 'anything' }, context))
      .rejects.toThrow('Semantic memory database is not active');
  });

  it('round-trips facts through the explicitly owned repository', async () => {
    const runtime = new SemanticMemoryRuntime();
    runtime.activate(new InMemoryMemoryEntryRepository());
    const tools = createNativeSemanticMemoryToolFeatures(runtime);
    const upsert = tools.find((tool) => tool.name === 'memory_upsert')!;
    const search = tools.find((tool) => tool.name === 'memory_search')!;

    const written = await upsert.definition.execute({
      key: 'preference:drink',
      content: 'likes tea',
      scope: 'user',
    }, context);
    const recalled = await search.definition.execute({
      query: 'tea',
      scope: 'user',
    }, context);

    expect(written).toContain('[user] preference:drink=likes tea');
    expect(recalled).toContain('[user:user-1] preference:drink=likes tea');
  });

  it('searches only memory visible to the canonical turn when scope is omitted', async () => {
    const repository = new InMemoryMemoryEntryRepository();
    await Promise.all([
      repository.upsert({ scope: 'global', key: 'shared', content: 'tea is served' }),
      repository.upsert({ scope: 'user', scope_key: 'user-1', key: 'mine', content: 'tea with milk' }),
      repository.upsert({ scope: 'user', scope_key: 'user-2', key: 'secret', content: 'tea password' }),
      repository.upsert({ scope: 'session', scope_key: 'session-2', key: 'foreign-session', content: 'tea secret' }),
      repository.upsert({ scope: 'platform', scope_key: 'discord', key: 'foreign-platform', content: 'tea secret' }),
    ]);
    const runtime = new SemanticMemoryRuntime();
    runtime.activate(repository);
    const search = createNativeSemanticMemoryToolFeatures(runtime)
      .find((tool) => tool.name === 'memory_search')!;

    const recalled = await search.definition.execute({ query: 'tea', limit: 20 }, context);

    expect(recalled).toContain('[global] shared=tea is served');
    expect(recalled).toContain('[user:user-1] mine=tea with milk');
    expect(recalled).not.toContain('password');
    expect(recalled).not.toContain('foreign-session');
    expect(recalled).not.toContain('foreign-platform');
  });

  it('derives platform scope only from a canonical IM origin', async () => {
    const runtime = new SemanticMemoryRuntime();
    runtime.activate(new InMemoryMemoryEntryRepository());
    const upsert = createNativeSemanticMemoryToolFeatures(runtime)
      .find((tool) => tool.name === 'memory_upsert')!;
    const httpContext = {
      ...context,
      origin: { kind: 'http' as const, sessionId: 'session-1' },
    } as ToolExecutionContext;

    await expect(upsert.definition.execute({
      key: 'platform:test',
      content: 'value',
      scope: 'platform',
    }, httpContext)).rejects.toThrow('requires an IM turn origin');
  });
});
