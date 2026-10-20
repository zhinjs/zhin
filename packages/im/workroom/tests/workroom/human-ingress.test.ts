import { describe, expect, it, vi } from 'vitest';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  HumanIngressProposalService,
  MemoryHumanIngressProposalRepository,
  type HumanIngressProposalEventDraft,
  type HumanIngressProposalInput,
  type HumanIngressProposalRepository,
  type HumanIngressTargetResolverPort,
  type HumanPrincipalSnapshot,
} from '../../src/workroom/human-ingress.js';
import {
  InteractionSpaceRouter,
  MemoryInteractionSpaceBindingRepository,
  createInteractionSpaceBinding,
  type InteractionSpace,
  type InteractionSpaceDecision,
} from '../../src/workroom/interaction-space-router.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;

const conversation = (): ConversationRef => ({
  endpoint: { adapter: 'plugin:github', id: 'endpoint:main' },
  kind: 'channel',
  id: 'repo:zhin',
  parent: { kind: 'group', id: 'org:zhinjs' },
  threadId: 'issue:842',
});

describe('HumanIngressProposalService', () => {
  it('persists unaddressed Workroom input only as a content-free Orchestrator Inbox proposal', async () => {
    const repository = new MemoryHumanIngressProposalRepository();
    const resolve: HumanIngressTargetResolverPort['resolve'] = request => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.decision)).toBe(true);
      expect(Object.isFrozen(request.sourceEvent)).toBe(true);
      expect(Object.isFrozen(request.principal)).toBe(true);
      return Object.freeze({
        ...request,
        status: 'unaddressed' as const,
        intent: 'work_request' as const,
        resolverRef: 'message-target-resolver:result:1',
        resolverDigest: SHA_C,
      });
    };
    const service = new HumanIngressProposalService(repository, { resolve });
    const outcome = await service.propose(await ingressInput('workroom'));

    expect(outcome).toMatchObject({
      status: 'proposed',
      duplicate: false,
      event: {
        sequence: 0,
        type: 'project_inbox.proposed',
        proposal: {
          status: 'proposed',
          projectId: 'project:zhin',
          space: 'workroom',
          intent: 'work_request',
          target: { orchestrator: true },
          authorityRequirement: 'none',
        },
      },
      projection: { sequence: 0, inbox: [{}], taskInputs: [] },
    });
    const encoded = JSON.stringify(outcome);
    expect(encoded).not.toContain('content');
    expect(encoded).not.toContain('text');
    expect(encoded).not.toContain('metadata');
  });

  it.each(['reply', 'mention'] as const)(
    'turns a trusted %s resolution only into an exact target-bound TaskInput proposal',
    async via => {
      const repository = new MemoryHumanIngressProposalRepository();
      const service = new HumanIngressProposalService(repository, {
        resolve: request => Object.freeze({
          ...request,
          status: 'task_target' as const,
          intent: 'discussion' as const,
          resolverRef: `message-target-resolver:${via}:1`,
          resolverDigest: SHA_C,
          via,
          target: Object.freeze({
            projectId: 'project:zhin',
            runId: 'run:1',
            taskKey: 'build',
            taskRevision: 3,
            assignmentId: 'assignment:architect:1',
            assignmentRevision: 2,
            agentDefinitionId: 'agent:architect',
            status: 'active' as const,
          }),
        }),
      });

      const outcome = await service.propose(await ingressInput('workroom'));

      expect(outcome).toMatchObject({
        status: 'proposed',
        event: {
          type: 'task_input.proposed',
          proposal: {
            kind: 'task_input',
            via,
            disposition: 'context_proposal',
            target: {
              projectId: 'project:zhin',
              runId: 'run:1',
              taskKey: 'build',
              taskRevision: 3,
              assignmentId: 'assignment:architect:1',
              assignmentRevision: 2,
            },
          },
        },
        projection: { inbox: [], taskInputs: [{}] },
      });
      expect(outcome).not.toHaveProperty('taskStatus');
      expect(outcome).not.toHaveProperty('runStatus');
    },
  );

  it.each([
    ['discussion', 'none'],
    ['control', 'typed_sponsor_control'],
  ] as const)(
    'keeps Sponsor Room %s non-authoritative as a later-policy proposal',
    async (intent, authorityRequirement) => {
      const service = new HumanIngressProposalService(
        new MemoryHumanIngressProposalRepository(),
        {
          resolve: request => Object.freeze({
            ...request,
            status: 'unaddressed' as const,
            intent,
            resolverRef: `sponsor-target-resolver:${intent}:1`,
            resolverDigest: SHA_C,
          }),
        },
      );

      await expect(service.propose(await ingressInput('sponsor_room'))).resolves.toMatchObject({
        status: 'proposed',
        event: {
          type: 'project_inbox.proposed',
          proposal: {
            space: 'sponsor_room',
            intent,
            authorityRequirement,
            status: 'proposed',
          },
        },
      });
    },
  );

  it('rejects body, metadata, role claims, caller targets, and non-Workroom decisions before resolution', async () => {
    const resolve = vi.fn<HumanIngressTargetResolverPort['resolve']>();
    const service = new HumanIngressProposalService(
      new MemoryHumanIngressProposalRepository(),
      { resolve },
    );
    const input = await ingressInput('workroom');
    const attempts = [
      { ...input, content: 'please cancel everything' },
      { ...input, messageMetadata: { sponsor: true } },
      { ...input, targetResolution: { status: 'unaddressed', intent: 'control' } },
      { ...input, principal: { ...input.principal, agentRole: 'orchestrator' } },
      { ...input, sourceEvent: { ...input.sourceEvent, text: 'hidden body' } },
    ];
    for (const attempt of attempts) {
      await expect(service.propose(attempt as never)).rejects.toThrow(/forbidden field/iu);
    }

    const chat = await new InteractionSpaceRouter(
      new MemoryInteractionSpaceBindingRepository(),
    ).resolve({ conversation: conversation(), conversationSequence: 1 });
    await expect(service.propose({ ...input, decision: chat } as never))
      .rejects.toThrow('resolved non-chat');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('fails closed on stale resolver echo or a cross-Project Task target', async () => {
    const input = await ingressInput('workroom');
    const stale = new HumanIngressProposalService(
      new MemoryHumanIngressProposalRepository(),
      {
        resolve: request => Object.freeze({
          ...request,
          decision: Object.freeze({
            ...request.decision,
            bindingRevision: request.decision.bindingRevision + 1,
          }),
          status: 'unaddressed' as const,
          intent: 'discussion' as const,
          resolverRef: 'resolver:stale',
          resolverDigest: SHA_C,
        }),
      },
    );
    await expect(stale.propose(input)).rejects.toThrow('stale for decision');

    const crossProject = new HumanIngressProposalService(
      new MemoryHumanIngressProposalRepository(),
      {
        resolve: request => Object.freeze({
          ...request,
          status: 'task_target' as const,
          intent: 'discussion' as const,
          resolverRef: 'resolver:cross-project',
          resolverDigest: SHA_C,
          via: 'reply' as const,
          target: Object.freeze({
            projectId: 'project:other',
            runId: 'run:other',
            taskKey: 'build',
            taskRevision: 1,
            status: 'active' as const,
          }),
        }),
      },
    );
    await expect(crossProject.propose(input)).rejects.toThrow('crosses Project');
  });

  it('requires the canonical source event conversation and sequence bound by Space resolution', async () => {
    const resolve = vi.fn<HumanIngressTargetResolverPort['resolve']>();
    const service = new HumanIngressProposalService(
      new MemoryHumanIngressProposalRepository(),
      { resolve },
    );
    const input = await ingressInput('workroom');

    await expect(service.propose({
      ...input,
      sourceEvent: { ...input.sourceEvent, sequence: input.sourceEvent.sequence + 1 },
    })).rejects.toThrow('does not match');
    await expect(service.propose({
      ...input,
      sourceEvent: {
        ...input.sourceEvent,
        conversation: { ...input.sourceEvent.conversation, threadId: 'issue:other' },
      },
    })).rejects.toThrow('does not match');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns clarification without creating a Project proposal', async () => {
    const repository = new MemoryHumanIngressProposalRepository();
    const service = new HumanIngressProposalService(repository, {
      resolve: request => Object.freeze({
        ...request,
        status: 'clarification_required' as const,
        intent: 'discussion' as const,
        resolverRef: 'resolver:ambiguous-alias',
        resolverDigest: SHA_C,
        reason: 'ambiguous_target' as const,
        candidateRefs: Object.freeze(['assignment:architect:1', 'assignment:architect:2']),
      }),
    });

    await expect(service.propose(await ingressInput('workroom'))).resolves.toEqual({
      status: 'clarification_required',
      sourceEventRef: 'conversation-event:message-1',
      reason: 'ambiguous_target',
      candidateRefs: ['assignment:architect:1', 'assignment:architect:2'],
    });
    await expect(repository.read('project:zhin')).resolves.toEqual([]);
  });

  it('keeps an exact historical target discussion-only instead of steering an expired Assignment', async () => {
    const service = new HumanIngressProposalService(
      new MemoryHumanIngressProposalRepository(),
      {
        resolve: request => Object.freeze({
          ...request,
          status: 'task_target' as const,
          intent: 'control' as const,
          resolverRef: 'resolver:historical-reply',
          resolverDigest: SHA_C,
          via: 'reply' as const,
          target: Object.freeze({
            projectId: 'project:zhin',
            runId: 'run:old',
            taskKey: 'build',
            taskRevision: 1,
            assignmentId: 'assignment:old',
            assignmentRevision: 1,
            status: 'historical' as const,
          }),
        }),
      },
    );

    await expect(service.propose(await ingressInput('workroom'))).resolves.toMatchObject({
      status: 'proposed',
      event: { proposal: {
        kind: 'task_input',
        disposition: 'discussion_only',
        authorityRequirement: 'workroom_control',
      } },
    });
  });
});

humanIngressRepositoryContract(
  'MemoryHumanIngressProposalRepository (process-local, non-durable)',
  () => new MemoryHumanIngressProposalRepository(),
);

function humanIngressRepositoryContract(
  name: string,
  createRepository: () => HumanIngressProposalRepository,
): void {
  describe(`${name} contract`, () => {
    it('allows exact replay but rejects same-position payload drift', async () => {
      const repository = createRepository();
      const first = await proposeWith(repository, await ingressInput('workroom'));
      const firstDraft = eventDraft(first);
      await expect(repository.append('project:zhin', -1, [firstDraft]))
        .resolves.toEqual([first]);

      const otherRepository = createRepository();
      const otherInput = await ingressInput('workroom');
      const other = await proposeWith(otherRepository, {
        ...otherInput,
        sourceEvent: { ...otherInput.sourceEvent, ref: 'conversation-event:message-other' },
      });
      await expect(repository.append('project:zhin', -1, [eventDraft(other)]))
        .rejects.toThrow('replay payload drift');
    });

    it('uses expected-sequence CAS so concurrent different source events have one winner', async () => {
      const repository = createRepository();
      const leftInput = await ingressInput('workroom');
      const rightInput = await ingressInput('workroom');
      const [left, right] = await Promise.allSettled([
        proposeWith(repository, {
          ...leftInput,
          sourceEvent: { ...leftInput.sourceEvent, ref: 'conversation-event:left' },
        }),
        proposeWith(repository, {
          ...rightInput,
          sourceEvent: { ...rightInput.sourceEvent, ref: 'conversation-event:right' },
        }),
      ]);

      expect([left.status, right.status].sort()).toEqual(['fulfilled', 'rejected']);
      await expect(repository.read('project:zhin')).resolves.toHaveLength(1);
    });

    it('does not allow a caller to append a duplicate proposal id at a later sequence', async () => {
      const repository = createRepository();
      const first = await proposeWith(repository, await ingressInput('workroom'));

      await expect(repository.append('project:zhin', 0, [eventDraft(first)]))
        .rejects.toThrow('event id is duplicated');
      await expect(repository.read('project:zhin')).resolves.toEqual([first]);
    });

    it('recovers an exact lost response as a duplicate proposal', async () => {
      const durable = createRepository();
      let loseResponse = true;
      const unreliable: HumanIngressProposalRepository = {
        read: async projectId => await durable.read(projectId),
        append: async (projectId, expectedSequence, drafts) => {
          const appended = await durable.append(projectId, expectedSequence, drafts);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('simulated response loss');
          }
          return appended;
        },
      };
      const input = await ingressInput('workroom');
      const service = new HumanIngressProposalService(unreliable, unaddressedResolver());

      await expect(service.propose(input)).rejects.toThrow('simulated response loss');
      await expect(service.propose(input)).resolves.toMatchObject({
        status: 'proposed',
        duplicate: true,
        event: { sequence: 0 },
      });
    });

    it('fails closed when repository replay contains corrupted proposal content', async () => {
      const durable = createRepository();
      const input = await ingressInput('workroom');
      const event = await proposeWith(durable, input);
      const corrupt: HumanIngressProposalRepository = {
        read: async () => [{
          ...event,
          proposal: { ...event.proposal, intent: 'control' },
        } as typeof event],
        append: async () => { throw new Error('append must not run'); },
      };

      await expect(new HumanIngressProposalService(
        corrupt,
        unaddressedResolver(),
      ).propose(input)).rejects.toThrow(/corrupt|authority requirement/iu);
    });

    it('rejects a re-digested proposal that removes the required control authority', async () => {
      const durable = createRepository();
      const input = await ingressInput('sponsor_room');
      const event = await new HumanIngressProposalService(
        durable,
        unaddressedResolver('control'),
      ).propose(input);
      if (event.status !== 'proposed') throw new Error('test fixture did not propose');
      const { digest: _proposalDigest, ...proposalContent } = event.event.proposal;
      const downgradedContent = { ...proposalContent, authorityRequirement: 'none' as const };
      const proposal = { ...downgradedContent, digest: digest(downgradedContent) };
      const { digest: _eventDigest, ...eventContent } = event.event;
      const forgedContent = { ...eventContent, proposal };
      const forged = { ...forgedContent, digest: digest(forgedContent) };
      const corrupt: HumanIngressProposalRepository = {
        read: async () => [forged],
        append: async () => { throw new Error('append must not run'); },
      };

      await expect(new HumanIngressProposalService(
        corrupt,
        unaddressedResolver('control'),
      ).propose(input)).rejects.toThrow('authority requirement');
    });
  });
}

function unaddressedResolver(
  intent: 'discussion' | 'work_request' | 'control' = 'work_request',
): HumanIngressTargetResolverPort {
  return {
    resolve: request => Object.freeze({
      ...request,
      status: 'unaddressed',
      intent,
      resolverRef: `resolver:unaddressed:${intent}`,
      resolverDigest: SHA_C,
    }),
  };
}

async function proposeWith(
  repository: HumanIngressProposalRepository,
  input: HumanIngressProposalInput,
) {
  const outcome = await new HumanIngressProposalService(
    repository,
    unaddressedResolver(),
  ).propose(input);
  if (outcome.status !== 'proposed') throw new Error('test fixture did not produce a proposal');
  return outcome.event;
}

function eventDraft(event: Awaited<ReturnType<typeof proposeWith>>): HumanIngressProposalEventDraft {
  return {
    eventId: event.eventId,
    type: event.type,
    proposal: event.proposal,
  };
}

const principal = (): HumanPrincipalSnapshot => Object.freeze({
  version: 1,
  ref: 'principal-snapshot:alice:7',
  revision: 7,
  digest: SHA_B,
  principalId: 'principal:alice',
  subjectId: 'github:alice',
  kind: 'human',
});

async function ingressInput(
  space: Exclude<InteractionSpace, 'chat'>,
): Promise<HumanIngressProposalInput> {
  return {
    decision: await resolvedDecision(space),
    sourceEvent: {
      version: 1,
      ref: 'conversation-event:message-1',
      digest: SHA_A,
      sequence: 1,
      conversation: conversation(),
    },
    principal: principal(),
  };
}

async function resolvedDecision(
  space: Exclude<InteractionSpace, 'chat'>,
): Promise<Extract<InteractionSpaceDecision, { status: 'resolved'; source: 'binding' }>> {
  const value = conversation();
  const repository = new MemoryInteractionSpaceBindingRepository();
  await repository.append(conversationRefKey(value), 0, [createInteractionSpaceBinding({
    conversation: value,
    bindingRevision: 1,
    effectiveAfterConversationSequence: 0,
    space,
    projectId: 'project:zhin',
    sourceRef: 'project-registry:binding:1',
    sourceDigest: SHA_B,
  })]);
  const decision = await new InteractionSpaceRouter(repository).resolve({
    conversation: value,
    conversationSequence: 1,
  });
  if (decision.status !== 'resolved' || decision.source !== 'binding') {
    throw new Error('test fixture did not resolve a binding');
  }
  return decision;
}
