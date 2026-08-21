import { describe, expect, it } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { Message } from '@zhin.js/core/runtime';
import {
  InteractionSpaceRouter,
  MemoryHumanIngressProposalRepository,
  MemoryInteractionSpaceBindingRepository,
} from '@zhin.js/agent';
import {
  WorkroomHumanIngressPreRoute,
  createCatalogWorkroomSpace,
} from '../../src/plugin-runtime/workroom-human-ingress-route.js';

const conversation = Object.freeze({
  endpoint: { adapter: 'plugin:telegram', id: 'endpoint:main' },
  kind: 'group' as const,
  id: 'group:engineering',
});

function message(id: string, content = 'please implement this'): Message {
  return new Message(
    conversation,
    content,
    1,
    async () => ({ status: 'sent' as const }),
    { id: 'alice' },
    Object.freeze({}),
    undefined,
    { conversation, id },
    'main',
  );
}

describe('WorkroomHumanIngressPreRoute', () => {
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
          principal: expect.objectContaining({ subjectId: 'alice' }),
          sourceEvent: expect.objectContaining({ sequence: 1 }),
          target: { orchestrator: true, agentDefinitionId: 'support' },
        }),
      }),
    ]);
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
});

function repositoriesFixture() {
  return {
    bindings: new MemoryInteractionSpaceBindingRepository(),
    proposals: new MemoryHumanIngressProposalRepository(),
  };
}

function fixture(
  resolveCatalogSpace: (message: Message) => ReturnType<typeof createCatalogWorkroomSpace> | null,
  repositories = repositoriesFixture(),
): WorkroomHumanIngressPreRoute {
  return new WorkroomHumanIngressPreRoute({
    bindings: repositories.bindings,
    proposals: repositories.proposals,
    resolveCatalogSpace,
    bindingRouter: new InteractionSpaceRouter(repositories.bindings),
    principalOwner: String(rootPluginId()),
  });
}
