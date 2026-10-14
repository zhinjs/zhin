/**
 * Self-tests for the eval framework: passing runs pass, broken expectations
 * fail with readable messages, and invalid fixtures are rejected up front.
 */
import { describe, expect, it } from 'vitest';
import {
  defineEvalCase,
  evaluateExpectations,
  formatEvalReport,
  loadEvalCases,
  runEvalCase,
  validateEvalCase,
  type EvalCase,
} from './index.js';

const RAW = 'RAW-PAYLOAD {"id":42,"secret_field":"do-not-show"}';

const approvalCase = (approval: EvalCase['approval']) => defineEvalCase({
  id: 'approval-gate',
  description: 'An approval-gated tool asks the approval channel first.',
  source: 'framework self-test',
  inbound: { text: '把这条消息转发到运营群', sender: { id: 'owner', roles: ['master'] } },
  tools: [{ name: 'forward_message', requiresApproval: 'once', result: 'forwarded' }],
  approval,
  script: [
    { toolCalls: [{ name: 'forward_message', args: { target: 'ops' } }] },
    { text: approval === 'approve' ? '已转发。' : '没有获得批准，未转发。' },
  ],
  expect: {},
});

describe('eval framework', () => {
  it('passes a case whose expectations hold and records approvals', async () => {
    const definition = { ...approvalCase('approve'), expect: {
      toolsCalled: ['forward_message'], approvalRequested: ['forward_message'], outboundContains: ['已转发'], modelSteps: 2,
    } };
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });

  it('records a TurnTrace per turn and attaches it to failure reports', async () => {
    const definition = { ...approvalCase('approve'), expect: { outboundContains: ['this text never appears'] } };
    const run = await runEvalCase(definition);
    expect(run.traces).toHaveLength(1);
    const [trace] = run.traces;
    expect(trace).toMatchObject({
      turn_id: 'approval-gate:turn-1',
      principal: { subject_id: 'owner', roles: ['master'] },
      termination: { status: 'completed' },
    });
    expect(trace!.model_calls.length).toBeGreaterThanOrEqual(1);
    // Tool events reach the trace through the journal port even though the
    // engine stream does not carry them (#740).
    expect(trace!.tool_calls).toEqual([expect.objectContaining({ tool_name: 'forward_message', status: 'ok' })]);
    const report = formatEvalReport(definition, run, evaluateExpectations(definition, run));
    expect(report).toContain('turn trace:');
    expect(report).toContain('回合 approval-gate:turn-1');
  });

  it('observes that a denied approval keeps the tool from running', async () => {
    const definition = { ...approvalCase('deny'), expect: {
      toolsNotCalled: ['forward_message'], approvalRequested: true, outboundContains: ['未转发'],
    } };
    const run = await runEvalCase(definition);
    expect(run.attemptedTools).toEqual(['forward_message']);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });

  it('reports every broken expectation with a readable message and trace', async () => {
    const definition = defineEvalCase({
      id: 'leaky-reply',
      description: 'The scripted reply pastes the raw tool payload.',
      source: 'framework self-test',
      inbound: { text: 'look it up' },
      tools: [{ name: 'lookup', result: RAW }, { name: 'delete_all' }],
      script: [
        { toolCalls: [{ name: 'lookup' }] },
        { text: `Here you go: ${RAW}` },
        { text: 'never requested' },
      ],
      expect: {
        toolsCalled: ['delete_all'],
        toolsNotCalled: ['lookup'],
        outboundContains: ['summary'],
        outboundNotContains: ['secret_field'],
        noRawToolOutput: true,
        approvalRequested: true,
        termination: 'error',
        modelSteps: 1,
      },
    });
    const run = await runEvalCase(definition);
    const failures = evaluateExpectations(definition, run);
    expect(failures.map((failure) => failure.assertion)).toEqual([
      'toolsCalled', 'toolsNotCalled', 'outboundContains', 'outboundNotContains',
      'noRawToolOutput', 'approvalRequested', 'termination', 'modelSteps', 'script',
    ]);
    const report = formatEvalReport(definition, run, failures);
    expect(report).toContain('eval "leaky-reply" failed');
    expect(report).toContain('expected tool "delete_all" to run; ran [lookup]');
    expect(report).toContain('outbound text echoes raw tool output');
    expect(report).toContain('1 scripted step(s) were never requested');
    expect(report).toContain('called=[lookup]');
  });

  it('fails a case when the harness asks for more steps than the script has', async () => {
    const definition = defineEvalCase({
      id: 'short-script',
      description: 'The script ends while the harness still wants a response.',
      source: 'framework self-test',
      inbound: { text: 'go' },
      tools: [{ name: 'lookup' }],
      script: [{ toolCalls: [{ name: 'lookup' }] }],
      expect: { termination: 'turn_end' },
    });
    const run = await runEvalCase(definition);
    const failures = evaluateExpectations(definition, run);
    expect(run.extraModelRequests).toBeGreaterThan(0);
    expect(failures.map((failure) => failure.message))
      .toContainEqual(expect.stringMatching(/model request\(s\) after the 1-step script ran out/));
  });

  it('flags scripted calls to tools the harness never offered', async () => {
    const definition = defineEvalCase({
      id: 'unoffered-tool',
      description: 'The script calls a tool that is not available to the turn.',
      source: 'framework self-test',
      inbound: { text: 'go' },
      script: [{ toolCalls: [{ name: 'not_registered' }] }, { text: 'done' }],
      expect: {},
    });
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run).map((failure) => failure.message))
      .toContain('scripted call to not_registered (request #1) names a tool the harness did not offer');
  });

  it('supports generic provider faults as script steps', async () => {
    const definition = defineEvalCase({
      id: 'provider-faults',
      description: 'A scripted 429 is a real provider error: the harness retries and the next step answers.',
      source: 'framework self-test',
      inbound: { text: 'hi' },
      script: [{ fault: { kind: 'error', message: 'HTTP 429 rate limited', status: 429 } }, { text: 'recovered' }],
      expect: { outboundContains: ['recovered'], modelSteps: 2 },
    });
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });

  it('fails a notOffered call that the harness did offer', async () => {
    const definition = defineEvalCase({
      id: 'offered-after-all',
      description: 'The script claims a tool is withheld, but it is available.',
      source: 'framework self-test',
      inbound: { text: 'go' },
      tools: [{ name: 'lookup' }],
      script: [{ toolCalls: [{ name: 'lookup', notOffered: true }] }, { text: 'done' }],
      expect: {},
    });
    const run = await runEvalCase(definition);
    expect(evaluateExpectations(definition, run).map((failure) => failure.assertion)).toContain('notOffered');
  });

  it('is deterministic across runs', async () => {
    const definition = { ...approvalCase('approve'), expect: {} };
    const first = await runEvalCase(definition);
    const second = await runEvalCase(definition);
    expect(second.outbound).toEqual(first.outbound);
    expect(second.modelRequests.map((request) => request.toolCalls)).toEqual(first.modelRequests.map((request) => request.toolCalls));
  });

  it('rejects invalid fixtures with readable problems', () => {
    const invalid = {
      id: 'Bad Id',
      description: '',
      inbound: [],
      tools: [{ name: 'bash' }, { name: 'dup' }, { name: 'dup' }],
      script: [],
      expect: {},
    } as unknown as EvalCase;
    expect(validateEvalCase(invalid)).toEqual([
      'id "Bad Id" must be kebab-case',
      'description is required',
      'source is required (the issue or incident this case guards against)',
      'inbound must contain at least one message',
      'script must contain at least one step',
      'duplicate tool names: dup',
      'tool "bash" uses a reserved built-in name; mocked tools need their own names',
    ]);
    const valid = approvalCase('approve');
    expect(() => loadEvalCases({ 'a.case.ts': { default: valid }, 'b.case.ts': { default: valid } }))
      .toThrow('b.case.ts: id "approval-gate" already used by a.case.ts');
  });
});
