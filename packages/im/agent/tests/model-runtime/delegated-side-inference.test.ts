import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { createInferenceRuntime, defineProvider, normalizeProviderGraph, type DecisionResult } from '@zhin.js/ai/provider';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import { SubagentRuntime, type SubagentLifecycleEvent } from '../../src/subagent/subagent-runtime.js';
import { getAgentTurnConfiguration, runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { getAgentTurnDecisionRuntime, runWithAgentDecisionTurn } from '../../src/plugin-runtime/decision-runtime.js';
import { createNativeImageToolFeature } from '../../src/plugin-runtime/native-image-tool.js';
import { DEFAULT_CONFIG } from '../../src/config/index.js';
import { rankDecisionCandidates } from '../../src/decision/rank.js';
import type { DecisionObservation } from '../../src/decision/types.js';
import type { ModelExecutionScope } from '../../src/model-runtime/types.js';
import { assistant, context, graphFixture } from '../../../ai/tests/provider/fixtures.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

it.each([
  { disabled: false, fail: false },
  { disabled: true, fail: false },
  { disabled: false, fail: true },
])('runs child image and decision tools in its own retained scope after parent completion and HMR (%j)', async ({ disabled, fail }) => {
  const root = rootPluginId();
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    resources: new Map(), config: new Map(), capabilities: new Map(), projections: new Map() };
  const snapshots = new SnapshotStore(state);
  let retired = 0;
  snapshots.commit(0, { snapshot: state, dispose() { retired++; } });
  const initial = graphFixture();
  let graph = normalizeProviderGraph({ ...initial, purposes: { ...initial.purposes, agents: { worker: 'text' } } });
  const caller = { ...context, ownerId: 'alice' };
  const calls: { kind: string; operation: string; session: string; owner: string; revision: number; account: string }[] = [];
  const toolResults: unknown[] = [];
  const entered = deferred(), proceed = deferred(), completed = deferred();
  let languageCalls = 0;
  let disposed = 0;
  const definition = defineProvider({ id: 'fixture', contractVersion: '1',
    serviceSchema: { parse: (value: unknown) => value }, authentication: { methods: ['none'] },
    targets: () => ({ authentication: [], inference: [] }), models: service => service.models,
    createExecution(options) {
      const record = (kind: string) => calls.push({ kind, operation: options.context.operationId,
        session: options.context.sessionKey, owner: options.context.ownerId,
        revision: options.binding.graphRevision, account: options.binding.account.id });
      return {
        language: { generate: async ({ request, signal }) => {
          record('language');
          if (languageCalls++ === 0) {
            entered.resolve(); await proceed.promise;
            return { ...assistant(), stopReason: 'toolUse' as const, content: [
              { type: 'toolCall' as const, id: 'image', name: 'generate_image', arguments: { prompt: 'synthetic' } },
              { type: 'toolCall' as const, id: 'decision', name: 'check_decision', arguments: {} },
            ] };
          }
          toolResults.push(...request.context.messages.filter(message => message.role === 'toolResult'));
          if (fail) {
            manager.cancel(options.context.operationId.slice('subagent:'.length));
            signal.throwIfAborted();
          }
          return assistant('child completed');
        }, stream: async () => (async function* () {})() },
        image: { generate: async () => { record('image'); return { base64: 'aW1hZ2U=', mimeType: 'image/png', model: 'image' }; } },
        decision: { evaluate: async ({ questions }) => {
          record('decision');
          return { model: 'decision', usage: { inputTokens: 1, outputTokens: 1 },
            answers: Object.fromEntries(Object.keys(questions).map(key => [key, {
              type: 'score', score: 0.9, confidence: 0.9, legend: {}, probabilities: {},
            }])) } as DecisionResult<typeof questions>;
        } },
        dispose() { disposed++; },
      };
    },
  });
  const runtime = new ModelRuntimeService({ rootId: 'root', hostOwnerId: context.hostOwnerId, context: () => caller,
    inferenceFactory: ({ lease }) => createInferenceRuntime({ generationIdentity: lease.value,
      repository: { readGraph: async () => graph },
      drivers: { acquire: async ({ service }) => ({ reference: service.driver, definition, release() {} }) },
      credentials: () => ({ authorize: async () => ({ headers: {}, revision: 'one' }), bindRequest: ({ request }) => request }),
      fetch: () => async () => { throw new Error('Unexpected HTTP'); } }) });
  const lease = snapshots.acquire();
  const parent = await runtime.acquireForContext({ lease, snapshots, context: caller });
  const image = createNativeImageToolFeature({ resolveInference: () => {
    const models = getAgentTurnConfiguration()?.models;
    if (!models) throw new Error('Missing child models');
    return models.inference;
  } });
  const decisionPolicies: string[] = [];
  const events: SubagentLifecycleEvent[] = [];
  const parentObservations: DecisionObservation[] = [];
  const childPerception = { kinds: [] as const, maxItemsPerTurn: 1, accepts: () => false, describe: async () => undefined };
  const createPerception = vi.fn((_models: ModelExecutionScope) => childPerception);
  const manager = new SubagentRuntime({ workspace: '/fixture', maxIterations: 3,
    onEvent: event => { events.push(event); },
    execPolicyConfig: { ...DEFAULT_CONFIG, subagentTools: ['generate_image', 'check_decision'] },
    createTools: () => [
      { name: 'generate_image', description: image.definition.description, parameters: image.definition.inputSchema,
        source: 'builtin', requiresApproval: 'never', execute: (args, _context, execution) => image.definition.execute(args, execution) },
      { name: 'check_decision', description: 'Evaluate the current decision purpose', parameters: { type: 'object', properties: {} },
        source: 'builtin', requiresApproval: 'never', execute: async (_args, _context, execution) => {
          const decision = getAgentTurnDecisionRuntime();
          expect(getAgentTurnConfiguration()?.mediaPerception).toBe(childPerception);
          decisionPolicies.push(decision?.config.tools?.mode ?? 'missing');
          const provider = decision?.forTask('tools');
          if (!provider) {
            if (disabled) return 'disabled';
            throw new Error('Missing child decision policy');
          }
          return rankDecisionCandidates(decision, 'tools', 'synthetic', [{ name: 'image', description: 'Synthetic image tool' }], execution.signal);
        } },
    ], registerSubagentTask: task => { void task.then(() => completed.resolve()); } });
  manager.configureRouting({ createPerception });
  try {
    await runWithAgentDecisionTurn({ snapshot: lease.value, turnId: caller.operationId, models: parent, disabled,
      observe: observation => parentObservations.push(observation),
      inferenceSnapshot: parent.inferenceSnapshot }, () => runWithAgentTurnConfiguration({ models: parent },
      () => manager.spawn({ task: 'Generate a synthetic image and evaluate it', agent: 'worker',
        origin: { message: {} as import('@zhin.js/core').Message } })));
    await entered.promise;
    await parent.release(); lease.release();
    graph = normalizeProviderGraph({ ...graph, revision: 2,
      purposes: { ...graph.purposes, decisions: { tools: { mode: 'off' } } } });
    snapshots.commit(1, { snapshot: state, dispose() {} }); await runtime.dispose();
    expect(retired).toBe(0);
    proceed.resolve(); await completed.promise;
    expect(calls.map(call => call.kind)).toEqual(disabled
      ? ['language', 'image', 'language'] : ['language', 'image', 'decision', 'language']);
    expect(calls.every(call => call.operation.startsWith('subagent:') && call.session === call.operation
      && call.owner === 'alice' && call.revision === 1 && call.account === 'account')).toBe(true);
    expect(new Set(calls.map(call => call.operation)).size).toBe(1);
    expect(decisionPolicies).toEqual([disabled ? 'missing' : 'active']);
    expect(createPerception).toHaveBeenCalledOnce();
    const child = createPerception.mock.calls[0]?.[0];
    expect(child).not.toBe(parent);
    expect(parentObservations).toEqual([]);
    const finish = events.find(event => event.phase === 'finish');
    expect(calls[0]?.operation).toBe(`subagent:${finish?.taskId}`);
    expect(finish?.status).toBe(fail ? 'error' : 'ok');
    expect(finish?.decisionObservations ?? []).toEqual(disabled ? [] : [expect.objectContaining({ task: 'tools', mode: 'active', outcome: 'selected' })]);
    expect(toolResults).toHaveLength(2);
    expect(toolResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'generate_image', isError: false }),
      expect.objectContaining({ toolName: 'check_decision', isError: false }),
    ]));
    expect(disposed).toBe(disabled ? 3 : 4);
    await vi.waitFor(() => expect(retired).toBe(1));
    await expect(parent.inference.generateImage({ request: { prompt: 'late parent' } })).rejects.toThrow('operation-closed');
  } finally {
    proceed.resolve(); await manager.dispose(); await parent.release(); lease.release(); await snapshots.close();
  }
});
