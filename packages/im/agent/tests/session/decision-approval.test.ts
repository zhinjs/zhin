import { describe, expect, it, vi } from 'vitest';
import type { DecisionProvider } from '@zhin.js/ai';
import { DecisionApprovalJudgment } from '../../src/decision/approval.js';
import type { ApprovalJudgmentPort } from '../../src/decision/approval-judgment.js';
import { ApprovalReviewAgent, createAutoApprovalPort } from '../../src/session/approval-review-agent.js';
import type { ApprovalDecisionPort, ApprovalRequestInput } from '../../src/session/approval-port.js';

const INTENT = 'Carry out the specified private operation';

describe('DecisionApprovalJudgment', () => {
  it('requires bounded scope, authority and every atomic safety check before approving', async () => {
    const { judgment, evaluate } = fixture();
    const result = await judgment.judge(input());
    expect(result.decision).toBe('approve');
    expect(result.evidence?.answers.verdict.probabilities.approve).toBe(0.98);
    expect(result.evidence?.answers.verdict.confidence).toBe(0.98);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(Object.keys(evaluate.mock.calls[0]![0].questions)).toEqual([
      'bounded', 'destructive', 'disclosure', 'escalation', 'intent', 'verdict',
    ]);
  });

  it('supplies bounded current-turn intent and trusted principal evidence as request data', async () => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue(evidence());
    const judgment = new DecisionApprovalJudgment({
      provider: { evaluate }, policy: { mode: 'active' },
      intent: 'Mute the specified member for 30 minutes',
      principal: { subjectId: 'sender-one', roles: ['group_admin'] },
    });
    await judgment.judge(input());
    expect(evaluate.mock.calls[0]![0].state).toMatchObject({
      intent: 'Mute the specified member for 30 minutes', intentTruncated: false,
      principal: { subjectId: 'sender-one', roles: ['group_admin'] },
    });
    const bounded = new DecisionApprovalJudgment({
      provider: { evaluate }, policy: { mode: 'active' }, intent: 'x'.repeat(10_000),
    });
    await expect(bounded.judge(input())).resolves.toMatchObject({ decision: 'ask' });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['absent', undefined], ['empty', ''], ['whitespace', ' \n\t '], ['truncated', 'x'.repeat(8_193)],
  ])('asks a human for %s intent even when the provider would confidently approve', async (_label, intent) => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue(evidence());
    const judgment = new DecisionApprovalJudgment({ provider: { evaluate }, policy: { mode: 'active' }, intent });
    const ask = { requestApproval: vi.fn(async () => true) };
    const reviewer = new ApprovalReviewAgent({ judgment });
    await expect(createAutoApprovalPort(reviewer, ask).requestApproval(input().request)).resolves.toBe(true);
    expect(ask.requestApproval).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('accepts complete intent at the maximum evidence length', async () => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue(evidence());
    const intent = 'x'.repeat(8_192);
    const judgment = new DecisionApprovalJudgment({ provider: { evaluate }, policy: { mode: 'active' }, intent });
    await expect(judgment.judge(input())).resolves.toMatchObject({ decision: 'approve' });
    expect(evaluate.mock.calls[0]![0].state).toMatchObject({ intent, intentTruncated: false });
  });

  it.each(['destructive', 'disclosure', 'escalation'] as const)('rejects confident %s evidence even if the combined verdict says approve', async (risk) => {
    const value = evidence();
    value.answers[risk] = answer('yes');
    const { judgment } = fixture(value);
    await expect(judgment.judge(input())).resolves.toMatchObject({
      decision: 'reject', reason: `Unsafe operation: ${risk}`,
    });
  });

  it('escalates low confidence or insufficient authority to human review', async () => {
    const value = evidence();
    value.answers.verdict.confidence = 0.5;
    const { judgment } = fixture(value);
    const requestApproval = vi.fn(async () => true);
    const reviewer = new ApprovalReviewAgent({ judgment });
    await expect(createAutoApprovalPort(reviewer, { requestApproval }).requestApproval(input().request))
      .resolves.toBe(true);
    expect(requestApproval).toHaveBeenCalledTimes(1);
    value.answers.verdict.confidence = 0.98;
    value.answers.intent = answer('unknown');
    await expect(judgment.judge(input())).resolves.toMatchObject({ decision: 'ask' });
  });

  it('uses the chosen probability as well as confidence before approving', async () => {
    const value = evidence();
    value.answers.verdict.probabilities = { approve: 0.34, reject: 0.33, ask: 0.33 };
    const { judgment } = fixture(value);
    await expect(judgment.judge(input())).resolves.toMatchObject({ decision: 'ask' });
  });

  it.each(['missing', 'unknown-choice', 'nan', 'bad-distribution'])('fails closed on %s response', async (kind) => {
    const value = evidence();
    if (kind === 'missing') delete value.answers.intent;
    if (kind === 'unknown-choice') value.answers.verdict.choice = 'constructor';
    if (kind === 'nan') value.answers.verdict.confidence = NaN;
    if (kind === 'bad-distribution') value.answers.verdict.probabilities.approve = 3;
    const { judgment } = fixture(value);
    await expect(judgment.judge(input())).resolves.toMatchObject({ decision: 'reject' });
  });

  it('denies and cancels a provider that does not settle within the total budget', async () => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockReturnValue(new Promise<never>(() => {}));
    const judgment = new DecisionApprovalJudgment({
      provider: { evaluate }, policy: { mode: 'active', timeoutMs: 5 }, intent: INTENT,
    });
    await expect(judgment.judge(input())).resolves.toMatchObject({ decision: 'reject' });
    expect(evaluate.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it('preserves the parent cancellation reason and rejects late approval', async () => {
    let resolve!: (value: ReturnType<typeof evidence>) => void;
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockReturnValue(new Promise<ReturnType<typeof evidence>>(done => { resolve = done; }));
    const judgment = new DecisionApprovalJudgment({ provider: { evaluate }, policy: { mode: 'active' }, intent: INTENT });
    const controller = new AbortController();
    const reviewing = judgment.judge(input(controller.signal));
    const reason = new Error('Turn ended');
    controller.abort(reason);
    resolve(evidence());
    await expect(reviewing).resolves.toMatchObject({ decision: 'reject' });
    expect(evaluate.mock.calls[0]![1].signal.reason).toBe(reason);
  });

  it('does not call the provider in off mode and keeps the baseline authoritative in shadow mode', async () => {
    const baseline: ApprovalJudgmentPort = { judge: vi.fn(async () => ({ decision: 'reject', reason: 'baseline' })) };
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue(evidence());
    const observe = vi.fn();
    const off = new DecisionApprovalJudgment({ provider: { evaluate }, policy: { mode: 'off' }, baseline });
    await expect(off.judge(input())).resolves.toMatchObject({ decision: 'reject', reason: 'baseline' });
    expect(evaluate).not.toHaveBeenCalled();
    const shadow = new DecisionApprovalJudgment({ provider: { evaluate }, policy: { mode: 'shadow' }, baseline, observe, intent: INTENT });
    await expect(shadow.judge(input())).resolves.toMatchObject({ decision: 'reject', reason: 'baseline' });
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ mode: 'shadow', outcome: 'shadow' }));
    expect(JSON.stringify(observe.mock.calls)).not.toContain('private operation');
  });

  it('retains human sender grants on the shared reviewer when changing per-turn judgment', async () => {
    const baseline: ApprovalJudgmentPort = { judge: vi.fn(async () => ({ decision: 'reject', reason: 'unused' })) };
    const reviewer = new ApprovalReviewAgent({ judgment: baseline });
    const value = evidence();
    value.answers.intent = answer('unknown');
    const { judgment, evaluate } = fixture(value);
    const ask: ApprovalDecisionPort = {
      requestApprovalDecision: vi.fn(async () => 'approve-always' as const),
      requestApproval: async () => true,
    };
    const request = input().request;
    await expect(createAutoApprovalPort(reviewer, ask, judgment).requestApproval(request)).resolves.toBe(true);
    await expect(createAutoApprovalPort(reviewer).requestApproval({ ...request, requestId: 'again' })).resolves.toBe(true);
    expect(baseline.judge).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(1);
    await expect(createAutoApprovalPort(reviewer).requestApproval({ ...request, requesterId: 'other' })).resolves.toBe(false);
  });

  it('bounds an arbitrary judgment adapter even when it ignores abort', async () => {
    const reviewer = new ApprovalReviewAgent({ judgment: { judge: async () => await new Promise<never>(() => {}) }, timeoutMs: 5 });
    await expect(reviewer.review(input().request)).resolves.toBe('reject');
  });

  it.each(['transport', 'timeout'])('allows a healthy retry after a %s rejection', async (failure) => {
    const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue(evidence());
    if (failure === 'transport') evaluate.mockRejectedValueOnce(new Error('transport failed'));
    else evaluate.mockReturnValueOnce(new Promise<never>(() => {}));
    const judgment = new DecisionApprovalJudgment({
      provider: { evaluate }, policy: { mode: 'active', timeoutMs: 5 }, intent: INTENT,
    });
    const reviewer = new ApprovalReviewAgent({ judgment });
    const port = createAutoApprovalPort(reviewer);
    const request = input().request;
    await expect(port.requestApproval(request)).resolves.toBe(false);
    await expect(port.requestApproval({ ...request, requestId: 'healthy-retry' })).resolves.toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});

function input(signal = new AbortController().signal) {
  const request: ApprovalRequestInput = {
    requestId: 'request', sessionKey: 'group:one', requesterId: 'sender-one',
    conversationScope: 'group', scopeKey: 'operation-fingerprint', toolName: 'tool',
    question: 'private operation', signal,
  };
  return { request, priorDecisions: [], signal };
}

function answer(choice: string) {
  const choices = ['yes', 'no', 'unknown'];
  return { type: 'choice' as const, choice, confidence: 0.98, probabilities: Object.fromEntries(choices.map(key => [key, key === choice ? 0.98 : 0.01])) };
}

function evidence() {
  return {
    model: 'jev-fixed-version',
    answers: {
      bounded: answer('yes'), destructive: answer('no'), disclosure: answer('no'),
      escalation: answer('no'), intent: answer('yes'),
      verdict: { type: 'choice' as const, choice: 'approve', confidence: 0.98, probabilities: { approve: 0.98, reject: 0.01, ask: 0.01 } },
    } as Record<string, ReturnType<typeof answer>>,
    usage: { inputTokens: 100, outputTokens: 30 },
  };
}

function fixture(value = evidence()) {
  const evaluate = vi.fn<DecisionProvider['evaluate']>().mockResolvedValue(value);
  return { evaluate, judgment: new DecisionApprovalJudgment({ provider: { evaluate }, policy: { mode: 'active' }, intent: INTENT }) };
}
