import { describe, expect, it, vi } from 'vitest';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import {
  InteractionSpaceBindingService,
  type InteractionSpaceBindingAuthorityPort,
} from '../../src/workroom/interaction-space-binding-service.js';
import {
  MemoryInteractionSpaceBindingRepository,
  createInteractionSpaceBinding,
  type InteractionSpaceBindingRepository,
} from '../../src/workroom/interaction-space-router.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;

const conversation = (): ConversationRef => ({
  endpoint: { adapter: 'plugin:github', id: 'endpoint:main' },
  kind: 'channel',
  id: 'repo:zhin',
  parent: { kind: 'group', id: 'org:zhinjs' },
  threadId: 'issue:842',
});

describe('InteractionSpaceBindingService', () => {
  it('binds only an exact authority echo anchored to the trusted conversation barrier', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const authorize = vi.fn<InteractionSpaceBindingAuthorityPort['authorize']>(request => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.conversation)).toBe(true);
      expect(Object.isFrozen(request.conversation.endpoint)).toBe(true);
      return Object.freeze({
        ...request,
        authorized: true as const,
        authorizedBy: 'project-registry:policy:7',
      });
    });
    const service = new InteractionSpaceBindingService(
      repository,
      {
        readBarrier: async value => Object.freeze({
          version: 1,
          conversationKey: conversationRefKey(value),
          currentSequence: 41,
          sourceRef: 'conversation-events:cursor:41',
          sourceDigest: SHA_A,
        }),
      },
      { authorize },
    );

    const binding = await service.bind({
      conversation: conversation(),
      space: 'workroom',
      projectId: 'project:zhin',
      sourceRef: 'project-registry:binding:1',
      sourceDigest: SHA_B,
    });

    expect(binding).toMatchObject({
      bindingRevision: 1,
      effectiveAfterConversationSequence: 41,
      space: 'workroom',
      projectId: 'project:zhin',
      sourceRef: 'project-registry:binding:1',
      sourceDigest: SHA_B,
    });
    expect(authorize).toHaveBeenCalledOnce();
    await expect(repository.read(conversationRefKey(conversation())))
      .resolves.toEqual([binding]);
  });

  it('fails closed when authority is missing or denies the exact request', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const barrier = fixedBarrier(7);
    const input = workroomInput();

    await expect(new InteractionSpaceBindingService(repository, barrier).bind(input))
      .rejects.toThrow('Authority Port is not installed');
    const denied = new InteractionSpaceBindingService(repository, barrier, {
      authorize: request => Object.freeze({
        ...request,
        authorized: false,
        reason: 'Project registry does not authorize this binding',
      }),
    });
    await expect(denied.bind(input)).rejects.toThrow('authority denied');
    await expect(repository.read(conversationRefKey(conversation()))).resolves.toEqual([]);
  });

  it('does not treat a durable replay as a substitute for an installed authority', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const input = workroomInput();
    await new InteractionSpaceBindingService(
      repository,
      fixedBarrier(7),
      allowingAuthority(),
    ).bind(input);

    await expect(new InteractionSpaceBindingService(repository, fixedBarrier(7)).bind(input))
      .rejects.toThrow('Authority Port is not installed');
  });

  it('rejects stale authority echoes and caller-supplied authority fields', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const input = workroomInput();
    const stale = new InteractionSpaceBindingService(repository, fixedBarrier(7), {
      authorize: request => Object.freeze({
        ...request,
        sourceDigest: SHA_A,
        authorized: true,
        authorizedBy: 'project-registry:policy:7',
      }),
    });

    await expect(stale.bind(input)).rejects.toThrow('stale for sourceDigest');
    await expect(stale.bind({
      ...input,
      bindingRevision: 99,
    } as never)).rejects.toThrow('forbidden field bindingRevision');
    await expect(stale.bind({
      ...input,
      authorizedBy: 'message-metadata',
    } as never)).rejects.toThrow('forbidden field authorizedBy');
    await expect(repository.read(conversationRefKey(conversation()))).resolves.toEqual([]);
  });

  it('allows ordered revisions at one boundary but rejects a barrier behind durable history', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const value = conversation();
    await repository.append(conversationRefKey(value), 0, [createInteractionSpaceBinding({
      conversation: value,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 10,
      space: 'chat',
      sourceRef: 'project-registry:binding:prior',
      sourceDigest: SHA_A,
    })]);
    const authorize = vi.fn<InteractionSpaceBindingAuthorityPort['authorize']>();

    await expect(new InteractionSpaceBindingService(
      repository,
      fixedBarrier(9),
      { authorize },
    ).bind(workroomInput())).rejects.toThrow('must not move behind');
    expect(authorize).not.toHaveBeenCalled();

    await expect(new InteractionSpaceBindingService(
      repository,
      fixedBarrier(10),
      allowingAuthority(),
    ).bind(workroomInput())).resolves.toMatchObject({
      bindingRevision: 2,
      effectiveAfterConversationSequence: 10,
      space: 'workroom',
    });
  });

  it('recovers an exact lost-response decision without issuing a new authorization', async () => {
    const durable = new MemoryInteractionSpaceBindingRepository();
    let loseResponse = true;
    const repository: InteractionSpaceBindingRepository = {
      read: async key => await durable.read(key),
      append: async (key, revision, bindings) => {
        const appended = await durable.append(key, revision, bindings);
        if (loseResponse) {
          loseResponse = false;
          throw new Error('simulated response loss');
        }
        return appended;
      },
    };
    const authorize = vi.fn<InteractionSpaceBindingAuthorityPort['authorize']>(request =>
      Object.freeze({
        ...request,
        authorized: true as const,
        authorizedBy: 'project-registry:policy:7',
      }));
    const service = new InteractionSpaceBindingService(repository, fixedBarrier(12), { authorize });

    await expect(service.bind(workroomInput())).rejects.toThrow('simulated response loss');
    await expect(service.bind(workroomInput())).resolves.toMatchObject({
      bindingRevision: 1,
      effectiveAfterConversationSequence: 12,
    });
    expect(authorize).toHaveBeenCalledOnce();
    await expect(service.bind({ ...workroomInput(), space: 'sponsor_room' }))
      .rejects.toThrow('replay payload drift');
  });

  it('enforces chat, workroom, and sponsor-room Project semantics', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const service = new InteractionSpaceBindingService(
      repository,
      fixedBarrier(1),
      allowingAuthority(),
    );

    await expect(service.bind({
      ...workroomInput(),
      space: 'chat',
    })).rejects.toThrow('chat must not carry projectId');
    const { projectId: _projectId, ...withoutProject } = workroomInput();
    await expect(service.bind(withoutProject)).rejects.toThrow('requires projectId');
    await expect(service.bind({ ...withoutProject, space: 'sponsor_room' }))
      .rejects.toThrow('requires projectId');

    const chat = await service.bind({
      ...withoutProject,
      space: 'chat',
      sourceRef: 'project-registry:binding:chat',
    });
    expect(chat).toMatchObject({ space: 'chat', bindingRevision: 1 });
  });

  it('uses repository CAS so concurrent different decisions have only one winner', async () => {
    const repository = new MemoryInteractionSpaceBindingRepository();
    const service = new InteractionSpaceBindingService(
      repository,
      fixedBarrier(9),
      allowingAuthority(),
    );
    const [left, right] = await Promise.allSettled([
      service.bind({ ...workroomInput(), sourceRef: 'project-registry:binding:left' }),
      service.bind({ ...workroomInput(), sourceRef: 'project-registry:binding:right' }),
    ]);

    expect([left.status, right.status].sort()).toEqual(['fulfilled', 'rejected']);
    await expect(repository.read(conversationRefKey(conversation()))).resolves.toHaveLength(1);
  });
});

function fixedBarrier(currentSequence: number) {
  return {
    readBarrier: async (value: ConversationRef) => Object.freeze({
      version: 1 as const,
      conversationKey: conversationRefKey(value),
      currentSequence,
      sourceRef: `conversation-events:cursor:${currentSequence}`,
      sourceDigest: SHA_A,
    }),
  };
}

function workroomInput() {
  return {
    conversation: conversation(),
    space: 'workroom' as const,
    projectId: 'project:zhin',
    sourceRef: 'project-registry:binding:1',
    sourceDigest: SHA_B,
  };
}

function allowingAuthority(): InteractionSpaceBindingAuthorityPort {
  return {
    authorize: request => Object.freeze({
      ...request,
      authorized: true,
      authorizedBy: 'project-registry:policy:7',
    }),
  };
}
