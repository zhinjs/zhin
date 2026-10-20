import {
  HumanIngressApplicationService,
  MemoryHumanIngressApplicationRepository,
  MemoryHumanIngressProposalRepository,
  HumanIngressProposalService,
  type HumanIngressApplicationRequest,
  type HumanIngressOrchestratorProposalPort,
  type HumanIngressIntent,
} from '../../src/index.js';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;
const conversation: ConversationRef = {
  endpoint: { adapter: 'qq', id: 'endpoint' },
  kind: 'group',
  id: 'room',
};

async function proposed(
  repository: MemoryHumanIngressProposalRepository,
  intent: HumanIngressIntent,
) {
  const service = new HumanIngressProposalService(repository, {
    resolve: request => Object.freeze({
      ...request,
      status: 'unaddressed' as const,
      intent,
      resolverRef: `resolver:${intent}:v1`,
      resolverDigest: sha(intent === 'discussion' ? '1' : intent === 'work_request' ? '2' : '3'),
    }),
  });
  const result = await service.propose({
    decision: {
      status: 'resolved',
      conversationKey: conversationRefKey(conversation),
      conversationSequence: 7,
      source: 'binding',
      space: 'workroom',
      bindingRevision: 2,
      bindingDigest: sha('a'),
      projectId: 'project-alpha',
    },
    sourceEvent: {
      version: 1,
      ref: `conversation-event:${intent}`,
      digest: sha('b'),
      sequence: 7,
      conversation,
    },
    principal: {
      version: 1,
      ref: 'principal:alice:1',
      revision: 1,
      digest: sha('c'),
      principalId: 'alice',
      subjectId: 'alice',
      kind: 'human',
    },
    entryAgentDefinitionId: 'orchestrator',
  });
  if (result.status !== 'proposed') throw new Error('fixture did not create a proposal');
  return result.event.proposal;
}

describe('HumanIngressApplicationService', () => {
  it.each([
    ['discussion', 'discussion_recorded'],
    ['work_request', 'plan_proposal_submitted'],
  ] as const)('delivers %s through the corresponding Orchestrator proposal request', async (
    intent,
    terminalKind,
  ) => {
    const proposals = new MemoryHumanIngressProposalRepository();
    const proposal = await proposed(proposals, intent);
    const requests: HumanIngressApplicationRequest[] = [];
    const port: HumanIngressOrchestratorProposalPort = {
      apply: async request => {
        requests.push(request);
        return Object.freeze({
          ...request.identity,
          status: 'applied' as const,
          kind: terminalKind,
          receiptRef: `receipt:${request.operationId}`,
          receiptDigest: sha('d'),
        });
      },
    };
    const applications = new MemoryHumanIngressApplicationRepository();
    const worker = new HumanIngressApplicationService({
      proposals,
      applications,
      port,
      now: () => 1_000,
    });

    const result = await worker.runOnce('project-alpha');

    expect(result).toMatchObject({ status: 'applied', proposalId: proposal.id, kind: terminalKind });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: intent === 'discussion' ? 'discussion' : 'work_request',
      operationId: `human-ingress-application:${proposal.id}`,
      proposal,
    });
    expect((await applications.read('project-alpha')).map(event => event.type)).toEqual([
      'proposal.claimed',
      'proposal.applied',
    ]);
  });

  it('persists a typed clarification for control instead of mutating a Task', async () => {
    const proposals = new MemoryHumanIngressProposalRepository();
    const proposal = await proposed(proposals, 'control');
    const applications = new MemoryHumanIngressApplicationRepository();
    const worker = new HumanIngressApplicationService({
      proposals,
      applications,
      now: () => 2_000,
      port: {
        apply: async request => Object.freeze({
          ...request.identity,
          status: 'clarification_required' as const,
          reason: 'missing_control_target' as const,
          candidateRefs: Object.freeze([]),
        }),
      },
    });

    const result = await worker.runOnce('project-alpha');

    expect(result).toMatchObject({
      status: 'clarification_required',
      proposalId: proposal.id,
      reason: 'missing_control_target',
    });
    expect((await applications.read('project-alpha')).at(-1)).toMatchObject({
      type: 'proposal.clarification_required',
      proposalId: proposal.id,
      reason: 'missing_control_target',
    });
  });

  it('persists fail-closed P12 planning disclosure clarification as a terminal fact', async () => {
    const proposals = new MemoryHumanIngressProposalRepository();
    const proposal = await proposed(proposals, 'work_request');
    const applications = new MemoryHumanIngressApplicationRepository();
    const worker = new HumanIngressApplicationService({
      proposals,
      applications,
      now: () => 2_500,
      port: {
        apply: async request => Object.freeze({
          ...request.identity,
          status: 'clarification_required' as const,
          reason: 'planning_disclosure_unavailable' as const,
          candidateRefs: Object.freeze([]),
        }),
      },
    });

    await expect(worker.runOnce('project-alpha')).resolves.toMatchObject({
      status: 'clarification_required',
      proposalId: proposal.id,
      reason: 'planning_disclosure_unavailable',
    });
    expect((await applications.read('project-alpha')).at(-1)).toMatchObject({
      type: 'proposal.clarification_required',
      reason: 'planning_disclosure_unavailable',
    });
  });

  it('retries a lost response after restart with the same idempotency identity', async () => {
    const proposals = new MemoryHumanIngressProposalRepository();
    const proposal = await proposed(proposals, 'work_request');
    const applications = new MemoryHumanIngressApplicationRepository();
    let now = 10_000;
    const operations: string[] = [];
    const errors: string[] = [];
    let calls = 0;
    const port: HumanIngressOrchestratorProposalPort = {
      apply: async request => {
        operations.push(request.operationId);
        calls += 1;
        if (calls === 1) throw new Error('response lost');
        return Object.freeze({
          ...request.identity,
          status: 'applied' as const,
          kind: 'plan_proposal_submitted' as const,
          receiptRef: 'kernel-plan-proposal:stable',
          receiptDigest: sha('e'),
        });
      },
    };
    const firstGeneration = new HumanIngressApplicationService({
      proposals,
      applications,
      port,
      now: () => now,
      retryDelayMs: 100,
      claimLeaseMs: 50,
      onError: error => errors.push(error instanceof Error ? error.message : String(error)),
    });

    expect(await firstGeneration.runOnce('project-alpha')).toMatchObject({
      status: 'retry_scheduled',
      proposalId: proposal.id,
      retryAt: 10_100,
    });
    now = 10_100;
    const restarted = new HumanIngressApplicationService({
      proposals,
      applications,
      port,
      now: () => now,
      retryDelayMs: 100,
      claimLeaseMs: 50,
    });
    expect(await restarted.runOnce('project-alpha')).toMatchObject({
      status: 'applied',
      proposalId: proposal.id,
    });
    expect(operations).toEqual([
      `human-ingress-application:${proposal.id}`,
      `human-ingress-application:${proposal.id}`,
    ]);
    expect(errors).toEqual(['response lost']);
    expect((await applications.read('project-alpha')).map(event => event.type)).toEqual([
      'proposal.claimed',
      'proposal.retry_scheduled',
      'proposal.claimed',
      'proposal.applied',
    ]);
  });

  it('fences concurrent consumers before invoking the downstream port', async () => {
    const proposals = new MemoryHumanIngressProposalRepository();
    await proposed(proposals, 'discussion');
    const applications = new MemoryHumanIngressApplicationRepository();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const port: HumanIngressOrchestratorProposalPort = {
      apply: async request => {
        calls += 1;
        await held;
        return Object.freeze({
          ...request.identity,
          status: 'applied' as const,
          kind: 'discussion_recorded' as const,
          receiptRef: 'discussion-fact:1',
          receiptDigest: sha('f'),
        });
      },
    };
    const one = new HumanIngressApplicationService({ proposals, applications, port, now: () => 1_000 });
    const two = new HumanIngressApplicationService({ proposals, applications, port, now: () => 1_000 });

    const pending = one.runOnce('project-alpha');
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(await two.runOnce('project-alpha')).toEqual({ status: 'waiting', wakeAt: 31_000 });
    release();
    await pending;
    expect(calls).toBe(1);
  });
});
