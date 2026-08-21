import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { Message } from '@zhin.js/core/runtime';
import {
  InteractionSpaceRouter,
  HumanIngressApplicationService,
  MemoryHumanIngressApplicationRepository,
  MemoryHumanIngressProposalRepository,
  MemoryInteractionSpaceBindingRepository,
} from '@zhin.js/agent';
import {
  WorkroomHumanIngressPreRoute,
  createCatalogWorkroomSpace,
  resolveWorkroomHumanIntent,
} from '../../src/plugin-runtime/workroom-human-ingress-route.js';

const conversation = Object.freeze({
  endpoint: { adapter: 'plugin:telegram', id: 'endpoint:main' },
  kind: 'group' as const,
  id: 'group:engineering',
});

function message(
  id: string,
  content = 'please implement this',
  replies?: unknown[],
  replyTo?: string,
): Message {
  return new Message(
    conversation,
    content,
    1,
    async value => {
      replies?.push(value);
      return { status: 'sent' as const };
    },
    { id: 'alice' },
    Object.freeze({}),
    undefined,
    { conversation, id },
    'main',
    undefined,
    replyTo ? { id: replyTo } : undefined,
  );
}

describe('WorkroomHumanIngressPreRoute', () => {
  it.each([
    ['hello team', 'discussion'],
    ['/work implement the durable consumer', 'work_request'],
    ['/control cancel run:42', 'control'],
  ] as const)('classifies %j as the explicit %s intent', (content, intent) => {
    expect(resolveWorkroomHumanIntent(message('intent', content))).toBe(intent);
  });

  it('keeps unbound conversations on the ordinary chat path', async () => {
    const route = fixture(() => null);

    await expect(route.preRoute(message('m1'), 1)).resolves.toBe(false);
  });

  it('routes the first message for a configured Workroom to Project Inbox', async () => {
    const repositories = repositoriesFixture();
    const configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'support',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const route = fixture(() => configured, repositories);

    await expect(route.preRoute(message('m1'), 1)).resolves.toBe(true);
    await expect(repositories.proposals.read('project:zhin')).resolves.toEqual([
      expect.objectContaining({
        proposal: expect.objectContaining({
          kind: 'project_inbox',
          projectId: 'project:zhin',
          intent: 'discussion',
          principal: expect.objectContaining({ subjectId: 'alice' }),
          sourceEvent: expect.objectContaining({ sequence: 1 }),
          target: { orchestrator: true, agentDefinitionId: 'support' },
        }),
      }),
    ]);
    await expect(repositories.applications.read('project:zhin')).resolves.toEqual([
      expect.objectContaining({ type: 'proposal.claimed' }),
      expect.objectContaining({ type: 'proposal.applied', kind: 'discussion_recorded' }),
    ]);
  });

  it('replies with a typed clarification after its durable lifecycle is committed', async () => {
    const repositories = repositoriesFixture();
    const configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'support',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const replies: unknown[] = [];
    const route = fixture(() => configured, repositories, {
      apply: request => Object.freeze({
        ...request.identity,
        status: 'clarification_required' as const,
        reason: 'missing_work_scope' as const,
        candidateRefs: Object.freeze([]),
      }),
    });

    await expect(route.preRoute(message('m-work', '/work build it', replies), 1)).resolves.toBe(true);

    expect((await repositories.applications.read('project:zhin')).at(-1)).toMatchObject({
      type: 'proposal.clarification_required',
      reason: 'missing_work_scope',
    });
    expect(replies).toEqual([expect.stringContaining('工作范围')]);
  });

  it('keeps removal as a barrier and supports an immediate next-sequence rebind', async () => {
    const repositories = repositoriesFixture();
    let configured: ReturnType<typeof createCatalogWorkroomSpace> | null = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'support',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const route = fixture(() => configured, repositories);
    await route.preRoute(message('m1'), 1);
    await route.preRoute(message('m2'), 2);

    configured = null;
    await expect(route.preRoute(message('m3'), 3)).resolves.toBe(true);
    await expect(new InteractionSpaceRouter(repositories.bindings).resolve({
      conversation,
      conversationSequence: 3,
    })).resolves.toMatchObject({ status: 'ignored', bindingRevision: 2 });

    configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'support',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'b'.repeat(64)}`,
    });
    await expect(route.preRoute(message('m4'), 4)).resolves.toBe(true);
    await expect(repositories.proposals.read('project:zhin')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ proposal: expect.objectContaining({
        sourceEvent: expect.objectContaining({ sequence: 4 }),
        target: { orchestrator: true, agentDefinitionId: 'support' },
      }) }),
    ]));
  });

  it('routes the first message after changing the entry Agent to the new Project Inbox', async () => {
    const repositories = repositoriesFixture();
    let configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'support',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const route = fixture(() => configured, repositories);
    await route.preRoute(message('m1'), 1);

    configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'triage',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'b'.repeat(64)}`,
    });
    await expect(route.preRoute(message('m2'), 2)).resolves.toBe(true);
    const proposals = await repositories.proposals.read('project:zhin');
    expect(proposals.at(-1)?.proposal).toMatchObject({
      sourceEvent: { sequence: 2 },
      target: { orchestrator: true, agentDefinitionId: 'triage' },
    });
  });

  it('retries a concurrent proposal CAS without dropping either source event', async () => {
    const repositories = repositoriesFixture();
    const configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin',
      agentDefinitionId: 'support',
      space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const route = fixture(() => configured, repositories);
    await route.preRoute(message('m1'), 1);

    await expect(Promise.all([
      route.preRoute(message('m2'), 2),
      route.preRoute(message('m3'), 3),
    ])).resolves.toEqual([true, true]);
    await expect(repositories.proposals.read('project:zhin')).resolves.toHaveLength(3);
  });

  it('records the exact binding and delegates replies to the durable target resolver', async () => {
    const repositories = repositoriesFixture();
    const configured = createCatalogWorkroomSpace({
      projectId: 'project:zhin', agentDefinitionId: 'support', space: 'workroom',
      sourceRef: 'workroom-catalog:project:zhin:conversation',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const onWorkroomResolved = vi.fn();
    const route = fixture(() => configured, repositories, undefined, {
      onWorkroomResolved,
      createTargetResolver: (_message, intent) => ({
        resolve: request => Object.freeze({
          ...request,
          status: 'task_target' as const,
          intent,
          resolverRef: 'projection-message-index:v1',
          resolverDigest: `sha256:${'c'.repeat(64)}`,
          via: 'reply' as const,
          target: Object.freeze({
            projectId: 'project:zhin', runId: 'run:1', taskKey: 'build',
            taskRevision: 1, assignmentId: 'assignment:1', assignmentRevision: 1,
            agentDefinitionId: 'developer', status: 'active' as const,
          }),
        }),
      }),
    });

    await route.preRoute(message('m-reply', '/work adjust this', undefined, 'projected-1'), 1);

    expect(onWorkroomResolved).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: { id: 'projected-1' } }),
      expect.objectContaining({ projectId: 'project:zhin', bindingRevision: 1 }),
    );
    expect((await repositories.proposals.read('project:zhin')).at(-1)?.proposal).toMatchObject({
      kind: 'task_input', via: 'reply',
      target: { assignmentId: 'assignment:1', status: 'active' },
    });
  });
});

function repositoriesFixture() {
  return {
    bindings: new MemoryInteractionSpaceBindingRepository(),
    proposals: new MemoryHumanIngressProposalRepository(),
    applications: new MemoryHumanIngressApplicationRepository(),
  };
}

function fixture(
  resolveCatalogSpace: (message: Message) => ReturnType<typeof createCatalogWorkroomSpace> | null,
  repositories = repositoriesFixture(),
  port: ConstructorParameters<typeof HumanIngressApplicationService>[0]['port'] = {
    apply: request => Object.freeze({
      ...request.identity,
      status: 'applied' as const,
      kind: request.kind === 'discussion'
        ? 'discussion_recorded' as const
        : request.kind === 'work_request'
          ? 'plan_proposal_submitted' as const
          : 'control_proposal_submitted' as const,
      receiptRef: `test-receipt:${request.operationId}`,
      receiptDigest: `sha256:${'d'.repeat(64)}`,
    }),
  },
  extra: Pick<
    ConstructorParameters<typeof WorkroomHumanIngressPreRoute>[0],
    'createTargetResolver' | 'onWorkroomResolved'
  > = {},
): WorkroomHumanIngressPreRoute {
  return new WorkroomHumanIngressPreRoute({
    bindings: repositories.bindings,
    proposals: repositories.proposals,
    application: new HumanIngressApplicationService({
      proposals: repositories.proposals,
      applications: repositories.applications,
      port,
    }),
    resolveCatalogSpace,
    resolveIntent: resolveWorkroomHumanIntent,
    ...extra,
    bindingRouter: new InteractionSpaceRouter(repositories.bindings),
    principalOwner: String(rootPluginId()),
  });
}
