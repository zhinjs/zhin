import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_TOKEN_USAGE,
  type AssistantMessage,
  type LlmCompletionPort,
  type Model,
} from '@zhin.js/ai';
import {
  ApprovalReviewAgent,
  createAutoApprovalPort,
} from '../../src/session/approval-review-agent.js';
import type { ApprovalDecisionPort } from '../../src/session/approval-port.js';

const model: Model = {
  id: 'reviewer',
  provider: 'test',
  api: 'ai-sdk',
  input: ['text'],
  contextWindow: 8_192,
  maxTokens: 160,
};

describe('ApprovalReviewAgent', () => {
  it('approves and rejects from the isolated structured verdict', async () => {
    const approve = reviewer('{"decision":"approve","reason":"bounded"}');
    const reject = reviewer('{"decision":"reject","reason":"destructive"}');

    await expect(createAutoApprovalPort(approve).requestApproval(request('approve')))
      .resolves.toBe(true);
    await expect(createAutoApprovalPort(reject).requestApproval(request('reject')))
      .resolves.toBe(false);
  });

  it('escalates an uncertain verdict through the unchanged ApprovalPort', async () => {
    const requestApproval = vi.fn(async () => true);
    const port = createAutoApprovalPort(
      reviewer('{"decision":"ask","reason":"intent unclear"}'),
      { available: true, requestApproval },
    );
    const input = request('ask');

    await expect(port.requestApproval(input)).resolves.toBe(true);
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      ...input,
      timeoutMs: 30_000,
      signal: expect.any(AbortSignal),
    }));
  });

  it('fails closed on invalid model output without escalating', async () => {
    const requestApproval = vi.fn(async () => true);
    const port = createAutoApprovalPort(
      reviewer('not-json'),
      { available: true, requestApproval },
    );

    await expect(port.requestApproval(request('invalid'))).resolves.toBe(false);
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('denies when a master escalation does not settle before timeout', async () => {
    const port = createAutoApprovalPort(
      reviewer('{"decision":"ask","reason":"intent unclear"}'),
      { available: true, requestApproval: async () => await new Promise<boolean>(() => {}) },
    );

    await expect(port.requestApproval({ ...request('timeout'), timeoutMs: 5 }))
      .resolves.toBe(false);
  });

  it('reuses sender grants only for the same session, sender, and operation', async () => {
    const { agent, complete } = trackedReviewer([
      '{"decision":"ask","reason":"human authority required"}',
      '{"decision":"reject","reason":"different sender"}',
      '{"decision":"reject","reason":"different session"}',
    ]);
    const requestApprovalDecision = vi.fn(async () => 'approve-always' as const);
    const ask: ApprovalDecisionPort = {
      available: true,
      requestApprovalDecision,
      requestApproval: async input => (await requestApprovalDecision(input)) !== 'reject',
    };
    const port = createAutoApprovalPort(agent, ask);
    const original = request('original');

    await expect(port.requestApproval(original)).resolves.toBe(true);
    await expect(port.requestApproval({ ...original, requestId: 'same-principal' }))
      .resolves.toBe(true);
    await expect(port.requestApproval({
      ...original,
      requestId: 'different-sender',
      requesterId: 'sender-b',
    })).resolves.toBe(false);
    await expect(port.requestApproval({
      ...original,
      requestId: 'different-session',
      sessionKey: 'group:other',
    })).resolves.toBe(false);

    expect(complete).toHaveBeenCalledTimes(3);
    expect(requestApprovalDecision).toHaveBeenCalledTimes(1);
  });

  it('reuses session grants for different senders in the same conversation', async () => {
    const { agent, complete } = trackedReviewer([
      '{"decision":"ask","reason":"human authority required"}',
    ]);
    const requestApprovalDecision = vi.fn(async () => 'approve-session' as const);
    const ask: ApprovalDecisionPort = {
      available: true,
      requestApprovalDecision,
      requestApproval: async input => (await requestApprovalDecision(input)) !== 'reject',
    };
    const port = createAutoApprovalPort(agent, ask);
    const input = request('session-scope');

    await expect(port.requestApproval(input)).resolves.toBe(true);
    await expect(port.requestApproval({
      ...input,
      requestId: 'session-scope-other-sender',
      requesterId: 'sender-b',
    })).resolves.toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(requestApprovalDecision).toHaveBeenCalledTimes(1);
  });

  it('keeps private always grants inside the private conversation', async () => {
    const { agent, complete } = trackedReviewer([
      '{"decision":"ask","reason":"human authority required"}',
      '{"decision":"reject","reason":"different private conversation"}',
    ]);
    const requestApprovalDecision = vi.fn(async () => 'approve-always' as const);
    const ask: ApprovalDecisionPort = {
      available: true,
      requestApprovalDecision,
      requestApproval: async input => (await requestApprovalDecision(input)) !== 'reject',
    };
    const port = createAutoApprovalPort(agent, ask);
    const input = { ...request('private-always'), conversationScope: 'private' as const };

    await expect(port.requestApproval(input)).resolves.toBe(true);
    await expect(port.requestApproval({ ...input, requestId: 'private-same-session' }))
      .resolves.toBe(true);
    await expect(port.requestApproval({
      ...input,
      requestId: 'private-other-session',
      sessionKey: 'private:other',
    })).resolves.toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(requestApprovalDecision).toHaveBeenCalledTimes(1);
  });

  it('does not reuse approve-once decisions', async () => {
    const { agent, complete } = trackedReviewer([
      '{"decision":"approve","reason":"bounded"}',
      '{"decision":"reject","reason":"new review"}',
    ]);
    const port = createAutoApprovalPort(agent);
    const input = request('once');

    await expect(port.requestApproval(input)).resolves.toBe(true);
    await expect(port.requestApproval({ ...input, requestId: 'once-again' }))
      .resolves.toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('reuses a human rejection for the same session sender and operation', async () => {
    const { agent, complete } = trackedReviewer([
      '{"decision":"ask","reason":"human authority required"}',
    ]);
    const requestApprovalDecision = vi.fn(async () => 'reject' as const);
    const ask: ApprovalDecisionPort = {
      available: true,
      requestApprovalDecision,
      requestApproval: async input => (await requestApprovalDecision(input)) !== 'reject',
    };
    const port = createAutoApprovalPort(agent, ask);
    const input = request('reject');

    await expect(port.requestApproval(input)).resolves.toBe(false);
    await expect(port.requestApproval({ ...input, requestId: 'reject-again' }))
      .resolves.toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(requestApprovalDecision).toHaveBeenCalledTimes(1);
  });
});

function reviewer(output: string): ApprovalReviewAgent {
  const complete = vi.fn(async () => assistant(output));
  const completion = {
    complete,
    completeSimple: complete,
  } satisfies LlmCompletionPort;
  return new ApprovalReviewAgent({ completion, model });
}

function trackedReviewer(outputs: string[]) {
  const complete = vi.fn(async () => assistant(outputs.shift() ?? '{"decision":"reject","reason":"missing fixture"}'));
  const completion = { complete, completeSimple: complete } satisfies LlmCompletionPort;
  return {
    agent: new ApprovalReviewAgent({ completion, model }),
    complete,
  };
}

function assistant(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'ai-sdk',
    provider: 'test',
    model: 'reviewer',
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function request(id: string) {
  return {
    requestId: id,
    sessionKey: 'group:123',
    conversationScope: 'group' as const,
    requesterId: 'sender-a',
    toolName: 'bash',
    scopeKey: 'bash:{"command":"pnpm test"}',
    question: 'Run npm test in the workspace?',
    signal: new AbortController().signal,
  };
}
