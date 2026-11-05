import { createInferenceRuntime, normalizeProviderGraph } from '@zhin.js/ai/provider';
import { graphFixture } from '../../../ai/tests/provider/fixtures.js';
import { codexProvider, openAiProvider } from '@zhin.js/ai/providers';
import { createInvocationCompletion, invocationModel } from '../../src/model-runtime/completion.js';
import { LlmApprovalJudgment } from '../../src/decision/approval-judgment.js';
import { summarizeSubagentResultForUser } from '../../src/routing/subagent-summarize.js';
import { driverFixture, callContext, sse, chatReply } from '../../../ai/tests/providers/fixtures.js';
import { executionCandidate } from '../helpers/execution-bundle.js';

function codexReply(text: string) {
  return sse([
    { type: 'response.created', response: { id: 'resp_local', created_at: 1, model: 'codex-local' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_local' } },
    { type: 'response.output_text.delta', item_id: 'msg_local', output_index: 0, content_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_local' } },
    { type: 'response.completed', response: { usage: { input_tokens: 20, output_tokens: 4 } } },
  ]);
}
const signal = new AbortController().signal;
const request = { requestId: 'synthetic', requesterId: 'synthetic', toolName: 'synthetic', scopeKey: 'synthetic', question: 'synthetic' };
it.each(['summary', 'approval'] as const)('runs the real %s purpose through its fixed Codex scope without unsupported framework overrides', async purpose => {
  const bodies: unknown[] = [];
  const payload = purpose === 'summary' ? 'Concise synthetic summary.' : JSON.stringify({ decision: 'ask', reason: 'Confirm intent' });
  const original = graphFixture();
  const model = { id: 'codex-local', kinds: ['language'] as const, protocol: 'codex-responses', streaming: true, input: ['text'] as const };
  const graph = normalizeProviderGraph({ ...original,
    services: { service: { ...original.services.service, driver: { id: codexProvider.id, owner: 'root/providers', contractVersion: '1' }, options: {}, models: { 'codex-local': model, 'different-summary': { ...model, id: 'different-summary' } } } },
    accounts: { account: { ...original.accounts.account, authentication: { method: 'oauth' } } },
    profiles: { chat: { ...original.profiles.text, id: 'chat', model: 'codex-local' }, summary: { ...original.profiles.text, id: 'summary', model: 'different-summary' } },
    purposes: { defaults: { chat: 'chat', summary: 'summary' } } });
  const runtime = createInferenceRuntime({ repository: { readGraph: async () => graph },
    drivers: { acquire: async () => ({ reference: graph.services.service.driver, definition: codexProvider, release() {} }) },
    credentials: () => ({ bindRequest: (input: { request: Request }) => input.request, authorize: async () => ({ token: 'synthetic-key', revision: '1', headers: {} }) }),
    fetch: () => async (url, init) => { bodies.push(await new Request(url, init).json()); return codexReply(payload); } });
  const selectedPurpose = purpose === 'approval' ? 'chat' : 'summary';
  const scope = await runtime.openScope({ context: callContext }), binding = await scope.resolve({ kind: 'language', purpose: selectedPurpose });
  const bundle = { binding, model: invocationModel(binding), completion: createInvocationCompletion({ binding, client: scope.client, purpose: selectedPurpose }) };
  try {
    if (purpose === 'summary') {
      expect(await summarizeSubagentResultForUser({ models: { summary: executionCandidate(bundle) }, subagentName: 'child', userRequest: 'summarize', subagentResult: 'Long raw synthetic report', signal })).toBe(payload);
    } else {
      expect(await new LlmApprovalJudgment({ completion: bundle.completion, model: bundle.model }).judge({ request, priorDecisions: [], signal })).toEqual({ decision: 'ask', reason: 'Confirm intent' });
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: purpose === 'approval' ? 'codex-local' : 'different-summary', store: false });
    expect(bodies[0]).not.toHaveProperty('temperature'); expect(bodies[0]).not.toHaveProperty('max_output_tokens');
  } finally { await scope.close(); runtime.retire(); }
});

it('uses ordinary Profile generation parameters unchanged through the real summary caller and SDK wire', async () => {
  const bodies: unknown[] = [];
  const fixture = driverFixture({ definition: openAiProvider, model: { id: 'configured-model', kinds: ['language'], protocol: 'openai-chat', input: ['text'] }, parameters: { temperature: 0.17, maxOutputTokens: 73 },
    fetch: async (url, init) => { bodies.push(await new Request(url, init).json()); return chatReply('summary'); } });
  const scope = await fixture.runtime.openScope({ context: callContext }), binding = await scope.resolve({ kind: 'language', purpose: 'summary' });
  const summary = { binding, model: invocationModel(binding), completion: createInvocationCompletion({ binding, client: scope.client, purpose: 'summary' }) };
  expect(await summarizeSubagentResultForUser({ models: { summary: executionCandidate(summary) }, subagentName: 'child', userRequest: 'summarize', subagentResult: 'raw' })).toBe('summary');
  expect(bodies).toEqual([expect.objectContaining({ model: 'configured-model', temperature: 0.17, max_tokens: 73 })]);
  await scope.close(); fixture.runtime.retire();
});


it('returns the completed child result when lazy summary acquisition fails', async () => {
  const resolve = vi.fn(async () => { throw new Error('synthetic summary configuration failure'); });
  const graph = graphFixture();
  const candidate = { binding: { graphRevision: graph.revision, service: graph.services.service, account: graph.accounts.account,
    profile: graph.profiles.text, model: graph.services.service.models[graph.profiles.text.model] }, resolve };
  expect(await summarizeSubagentResultForUser({ models: { summary: candidate }, subagentName: 'child',
    userRequest: 'summarize', subagentResult: 'Preserved completed child result' })).toBe('Preserved completed child result');
  expect(resolve).toHaveBeenCalledOnce();
});
