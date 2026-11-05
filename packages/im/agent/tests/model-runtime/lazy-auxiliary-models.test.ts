import { createMemoryContextRepository, createUserMessage } from '@zhin.js/ai';
import { createScopedMediaPerceptionPort } from '../../src/media/scoped-perception.js';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';
import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { renderAgentOutput } from '../../src/outbound/agent-output.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { AgentCompactionRuntime } from '../../src/memory/compaction-runtime.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { createTurnSummaryExecutionResolver } from '../../src/memory/summary-model.js';

function fixture(denied: string) {
  const checked: string[] = [];
  const f = modelRuntimeFixture({ authorize: ({ binding }) => {
    checked.push(binding.profile.id);
    if (binding.profile.id === denied) throw new Error(`Unavailable auxiliary Profile: ${denied}`);
    return true;
  } });
  const original = f.graph;
  f.update({ ...original,
    services: { service: { ...original.services.service, models: { ...original.services.service.models,
      text: { ...original.services.service.models.text, input: ['text', 'image'] } } } },
    profiles: { ...original.profiles, ...Object.fromEntries(['summary', 'vision', 'backup'].map(id => [id, { ...original.profiles.text, id }])) },
    purposes: { defaults: { chat: 'text', summary: 'summary', perception: { profile: 'vision', fallbacks: ['backup'] } } },
  });
  return { ...f, checked };
}

describe('auxiliary models are acquired only at their consuming boundary', () => {
  it.each(['summary', 'vision', 'backup'])('allows plain chat without resolving unavailable %s', async denied => {
    const f = fixture(denied);
    const scope = await f.acquire();
    try {
      const answer = await scope.chat.completion.complete(scope.chat.model, { systemPrompt: '', messages: [createUserMessage('Hello')] });
      expect(answer.content).toContainEqual({ type: 'text', text: 'done' });
      expect(f.checked.every(id => id === 'text')).toBe(true);
    } finally { await scope.release(); }
  });

  it('does not validate an unavailable backup when primary perception succeeds or cache is hit', async () => {
    const f = fixture('backup');
    const scope = await f.acquire();
    try {
      const port = createScopedMediaPerceptionPort({ scope, resilience: { maxRetries: 0 } })!;
      expect(f.checked.every(id => id === 'text')).toBe(true);
      const payload = { kind: 'image' as const, mimeType: 'image/png', base64: Buffer.from('synthetic image').toString('base64') };
      expect(await port.describe(payload)).toMatchObject({ text: 'done', cached: false });
      const checked = [...f.checked];
      expect(await port.describe(payload)).toMatchObject({ text: 'done', cached: true });
      expect(f.checked).toEqual(checked);
      expect(f.checked).not.toContain('backup');
    } finally { await scope.release(); }
  });

  it('resolves the declared backup only after the primary fails', async () => {
    const f = fixture('vision');
    const scope = await f.acquire();
    try {
      const port = createScopedMediaPerceptionPort({ scope, resilience: { maxRetries: 0 } })!;
      expect(await port.describe({ kind: 'image', mimeType: 'image/png', base64: Buffer.from('synthetic').toString('base64') }))
        .toMatchObject({ text: 'done', provider: 'backup' });
      expect(f.checked.indexOf('vision')).toBeLessThan(f.checked.indexOf('backup'));
    } finally { await scope.release(); }
  });

  it('resolves each candidate once from its captured graph even after the next turn changes it', async () => {
    const f = fixture('unused');
    const scope = await f.acquire();
    const graph = f.graph;
    f.update({ ...graph, revision: 2, profiles: { ...graph.profiles,
      summary: { ...graph.profiles.summary, revision: 2, parameters: { maxOutputTokens: 123 } } } });
    const acquisitions = f.calls.driverAcquires;
    try {
      const [first, same] = await Promise.all([scope.summary!.resolve(), scope.summary!.resolve()]);
      expect(first).toBe(same);
      expect(first.binding.profile.revision).toBe(1);
      expect(f.calls.driverAcquires).toBe(acquisitions + 1);
      const next = await f.acquire();
      try { expect((await next.summary!.resolve()).model.maxTokens).toBe(123); }
      finally { await next.release(); }
      expect(f.calls.reads).toBe(2);
    } finally { await scope.release(); }
  });

  it('runs a short real Agent turn without resolving a broken summary Driver', async () => {
    const f = modelRuntimeFixture({ describeModel: binding => {
      if (binding.profile.id === 'summary') throw new Error('Broken summary Driver');
      return {};
    } });
    f.update({ ...f.graph, profiles: { ...f.graph.profiles, summary: { ...f.graph.profiles.text, id: 'summary' } },
      purposes: { defaults: { chat: 'text', summary: 'summary' } } });
    const scope = await f.acquire();
    const agent = new ZhinAgent({ config: { outputSchema: false } });
    try {
      expect(renderAgentOutput(await agent.processTurn({ content: 'Hello', message: mockCommMessage(),
        configuration: { models: scope } }))).toBe('done');
      const resolveSummary = await runWithAgentTurnConfiguration({ models: scope }, async () =>
        createTurnSummaryExecutionResolver({ model: scope.chat.model, transport: scope.chat.completion }));
      const summary = vi.fn(resolveSummary);
      const messages = [createUserMessage('Short conversation')];
      const compaction = new AgentCompactionRuntime();
      const { repository: contextRepository } = createMemoryContextRepository();
      const transformed = await runWithAgentTurnConfiguration({ models: scope }, () => compaction.transformContext(messages, undefined, {
        host: { contextRepository }, sessionId: 'short', model: scope.chat.model,
        transport: scope.chat.completion, resolveExecution: summary, contextWindow: 32000,
      }));
      expect(transformed).toEqual(messages);
      expect(summary).not.toHaveBeenCalled();
      await expect(scope.summary!.resolve()).rejects.toThrow('Broken summary Driver');
    } finally { await agent.dispose(); await scope.release(); }
  });

  it.each(['release', 'cancel'] as const)('does not acquire unresolved candidates after %s', async action => {
    const f = fixture('unused');
    const lease = f.snapshots.acquire();
    const controller = new AbortController();
    const { context } = await import('../../../ai/tests/provider/fixtures.js');
    const scope = await f.runtime.acquireForContext({ lease, snapshots: f.snapshots, context, signal: controller.signal });
    const acquisitions = f.calls.driverAcquires;
    if (action === 'cancel') controller.abort(new Error('Turn cancelled'));
    else await scope.release();
    try {
      await expect(scope.summary!.resolve()).rejects.toThrow();
      await expect(scope.perception!.resolve()).rejects.toThrow();
      expect(f.calls.driverAcquires).toBe(acquisitions);
    } finally { await scope.release(); lease.release(); }
  });

  it('does not acquire a Driver when cancellation arrives during candidate authorization', async () => {
    let allow: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const waiting = new Promise<void>(resolve => { allow = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = modelRuntimeFixture({ authorize: async ({ binding }) => {
      if (binding.profile.id === 'summary') { entered(); await waiting; }
      return true;
    } });
    f.update({ ...f.graph, profiles: { ...f.graph.profiles, summary: { ...f.graph.profiles.text, id: 'summary' } },
      purposes: { defaults: { chat: 'text', summary: 'summary' } } });
    const lease = f.snapshots.acquire();
    const controller = new AbortController();
    const { context } = await import('../../../ai/tests/provider/fixtures.js');
    const scope = await f.runtime.acquireForContext({ lease, snapshots: f.snapshots, context, signal: controller.signal });
    const acquisitions = f.calls.driverAcquires;
    const pending = scope.summary!.resolve();
    await started;
    controller.abort(new Error('Turn cancelled'));
    allow();
    try {
      await expect(pending).rejects.toThrow();
      expect(f.calls.driverAcquires).toBe(acquisitions);
    } finally { await scope.release(); lease.release(); }
  });

  it.each(['resolved', 'rejected'] as const)('does not reactivate a %s candidate after release', async state => {
    const f = fixture(state === 'rejected' ? 'summary' : 'unused');
    const scope = await f.acquire();
    if (state === 'rejected') await expect(scope.summary!.resolve()).rejects.toThrow('Unavailable auxiliary Profile');
    else await scope.summary!.resolve();
    const acquisitions = f.calls.driverAcquires;
    const checked = [...f.checked];
    await scope.release();
    await expect(scope.summary!.resolve()).rejects.toThrow('operation-closed');
    expect(f.calls.driverAcquires).toBe(acquisitions);
    expect(f.checked).toEqual(checked);
  });
});
