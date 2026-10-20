import { InMemoryMemoryEntryRepository, type DecisionProvider, type DecisionQuestions,
  type DecisionRequest, type DecisionResult } from '@zhin.js/ai';
import type { ToolExecutionContext } from '@zhin.js/tool';
import type { AgentDecisionRuntime } from '../../src/decision/types.js';
import { createNativeSemanticMemoryToolFeatures, SemanticMemoryRuntime } from '../../src/plugin-runtime/native-semantic-memory-tools.js';
import { createNativeKnowledgeToolFeature, type KnowledgeIndex } from '../../src/plugin-runtime/native-knowledge-tool.js';
import { rerankDecisionMatches } from '../../src/decision/retrieval.js';

function context(roles: readonly string[] = ['user'], unattended = false): ToolExecutionContext {
  return { signal: new AbortController().signal, traceId: 'trace', turnId: 'turn', sessionKey: 'session',
    origin: { kind: 'im', platform: 'icqq', endpoint: 'account', scope: 'private', sceneId: 'user' },
    principal: { subjectId: 'user', roles }, policy: { permissions: [], unattended, network: { enabled: false } },
  } as ToolExecutionContext;
}

function runtime(mode: 'active' | 'shadow' = 'active'): AgentDecisionRuntime {
  const provider: DecisionProvider = {
    async evaluate<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
      const state = request.state as { candidates: Record<string, { description: string }> };
      return { model: 'jev-fixed', usage: { inputTokens: 1, outputTokens: 1 },
        answers: Object.fromEntries(Object.keys(request.questions).map(key => [key,
          { type: 'score', score: state.candidates[key]!.description.includes('preferred') ? 0.9 : 0.1,
            confidence: 0.9, legend: {}, probabilities: {} },
        ])) } as DecisionResult<Q>;
    },
  };
  return { provider, config: { provider: 'root/typesafe', memory: { mode } } };
}

describe('native retrieval decision integration', () => {
  it('reranks only scope-visible semantic memory and sends no foreign sender/session facts', async () => {
    const repository = new InMemoryMemoryEntryRepository();
    await repository.upsert({ scope: 'user', scope_key: 'user', key: 'mine', content: 'tea preferred with milk' });
    await repository.upsert({ scope: 'session', scope_key: 'session', key: 'shared', content: 'tea is a drink' });
    await repository.upsert({ scope: 'user', scope_key: 'other', key: 'secret', content: 'tea FOREIGN sender' });
    await repository.upsert({ scope: 'session', scope_key: 'other', key: 'secret', content: 'tea FOREIGN session' });
    const memory = new SemanticMemoryRuntime();
    memory.activate(repository);
    const baseline = createNativeSemanticMemoryToolFeatures(memory).find(tool => tool.name === 'memory_search')!;
    expect(await baseline.definition.execute({ query: 'tea', limit: 1 }, context())).toContain('tea is a drink');
    const decision = runtime();
    const evaluate = vi.spyOn(decision.provider, 'evaluate');
    const tool = createNativeSemanticMemoryToolFeatures(memory, () => decision).find(tool => tool.name === 'memory_search')!;
    const result = await tool.definition.execute({ query: 'tea', limit: 1 }, context());
    expect(result).toContain('preferred with milk');
    expect(result).not.toContain('tea is a drink');
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('FOREIGN');
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('includes search-matched tags in memory decision evidence', async () => {
    const repository = new InMemoryMemoryEntryRepository();
    await repository.upsert({ scope: 'user', scope_key: 'user', key: 'drink', content: 'milk', tags: ['tea', 'preferred'] });
    const memory = new SemanticMemoryRuntime();
    memory.activate(repository);
    const decision = runtime();
    const evaluate = vi.spyOn(decision.provider, 'evaluate');
    const tool = createNativeSemanticMemoryToolFeatures(memory, () => decision).find(tool => tool.name === 'memory_search')!;
    expect(await tool.definition.execute({ query: 'tea', limit: 1 }, context())).toContain('drink=milk');
    expect(evaluate.mock.calls[0]![0].state).toMatchObject({
      candidates: { candidate_0: { description: 'drink: milk\nTags: tea, preferred' } },
    });
  });

  it('preserves selected undefined values in a generic match collection', async () => {
    expect(await rerankDecisionMatches(runtime(), 'query', [undefined, 'baseline'],
      value => value === undefined ? 'preferred' : value, 1, new AbortController().signal)).toEqual([undefined]);
  });

  it('reranks existing knowledge hits, while shadow and provider failure preserve baseline results', async () => {
    const matches = [
      { source: 'guide.md', chunk: 0, score: 2, text: 'baseline paragraph' },
      { source: 'guide.md', chunk: 1, score: 1, text: 'preferred paragraph' },
    ];
    const index: KnowledgeIndex = { search: vi.fn(async (_query, limit) => ({ status: 'ready', indexedChunks: 2,
      matches: matches.slice(0, limit) })) };
    const decision = runtime();
    const active = createNativeKnowledgeToolFeature(index, () => decision);
    expect(await active.definition.execute({ query: 'paragraph', limit: 1 }, context())).toContain('preferred paragraph');
    expect(index.search).toHaveBeenCalledWith('paragraph', 20, expect.any(AbortSignal));
    const shadow = createNativeKnowledgeToolFeature(index, () => runtime('shadow'));
    expect(await shadow.definition.execute({ query: 'paragraph', limit: 1 }, context())).toContain('baseline paragraph');
    const failed = createNativeKnowledgeToolFeature(index, () => ({ ...decision,
      provider: { evaluate: async () => { throw new Error('network'); } } }));
    expect(await failed.definition.execute({ query: 'paragraph', limit: 1 }, context())).toContain('baseline paragraph');
  });

  it('never sends governed Workroom or unattended retrieval data to a decision provider', async () => {
    const resolveDecision = vi.fn(() => runtime());
    const index: KnowledgeIndex = { search: async () => ({ status: 'ready', indexedChunks: 1,
      matches: [{ source: 'project.md', chunk: 0, score: 1, text: 'governed data' }] }) };
    const tool = createNativeKnowledgeToolFeature(index, resolveDecision);
    await tool.definition.execute({ query: 'data' }, context(['workroom_assignment']));
    await tool.definition.execute({ query: 'data' }, context(['user'], true));
    expect(resolveDecision).not.toHaveBeenCalled();
  });
});
