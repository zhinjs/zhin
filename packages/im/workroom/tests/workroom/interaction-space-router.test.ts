import {
  InteractionSpaceRouter,
  MemoryInteractionSpaceBindingRepository,
  createInteractionSpaceBinding,
} from '../../src/workroom/interaction-space-router.js';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';

const baseConversation = (): ConversationRef => ({
  endpoint: { adapter: 'plugin:github', id: 'endpoint:github-main' },
  kind: 'channel',
  id: 'repo:zhin',
  parent: { kind: 'group', id: 'org:zhinjs' },
  threadId: 'issue:842',
});

describe('InteractionSpaceRouter', () => {
  it('defaults an unbound canonical address to chat without guessing from channel shape', async () => {
    const conversation = baseConversation();
    const conversationKey = conversationRefKey(conversation);
    const router = new InteractionSpaceRouter(new MemoryInteractionSpaceBindingRepository());

    await expect(router.resolve({ conversation, conversationSequence: 7 })).resolves.toEqual({
      status: 'resolved',
      conversationKey,
      conversationSequence: 7,
      source: 'default',
      space: 'chat',
    });
  });

  it('ignores replay that is not strictly after the current binding anchor', async () => {
    const conversation = baseConversation();
    const conversationKey = conversationRefKey(conversation);
    const repository = new MemoryInteractionSpaceBindingRepository();
    await repository.append(conversationKey, 0, [createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 10,
      space: 'workroom',
      projectId: 'project:zhin',
      sourceRef: 'project-registry:binding:1',
      sourceDigest: `sha256:${'1'.repeat(64)}`,
    })]);
    await repository.append(conversationKey, 1, [createInteractionSpaceBinding({
      conversation,
      bindingRevision: 2,
      effectiveAfterConversationSequence: 20,
      space: 'sponsor_room',
      projectId: 'project:zhin',
      sourceRef: 'project-registry:binding:2',
      sourceDigest: `sha256:${'2'.repeat(64)}`,
    })]);
    const router = new InteractionSpaceRouter(repository);

    await expect(router.resolve({ conversation, conversationSequence: 9 })).resolves.toMatchObject({
      status: 'ignored', bindingRevision: 2,
    });
    await expect(router.resolve({ conversation, conversationSequence: 19 })).resolves.toMatchObject({
      status: 'ignored', bindingRevision: 2,
    });
    await expect(router.resolve({ conversation, conversationSequence: 20 })).resolves.toMatchObject({
      status: 'ignored', bindingRevision: 2,
    });
    await expect(router.resolve({ conversation, conversationSequence: 21 })).resolves.toMatchObject({
      status: 'resolved', source: 'binding', space: 'sponsor_room', bindingRevision: 2,
    });
  });

  it('fails closed for unsequenced ingress once an address has binding history', async () => {
    const conversation = baseConversation();
    const conversationKey = conversationRefKey(conversation);
    const repository = new MemoryInteractionSpaceBindingRepository();
    await repository.append(conversationKey, 0, [createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 1,
      space: 'workroom',
      projectId: 'project:zhin',
      sourceRef: 'project-registry:binding:1',
      sourceDigest: `sha256:${'3'.repeat(64)}`,
    })]);

    await expect(new InteractionSpaceRouter(repository).resolve({ conversation })).resolves.toEqual({
      status: 'rejected',
      conversationKey,
      reason: 'conversation_sequence_required',
    });
  });

  it('keeps the full endpoint, parent, thread and topic address in canonical identity', () => {
    const conversation = baseConversation();
    const changedThread = { ...conversation, threadId: 'issue:843' };
    const changedOwner = { ...conversation, endpoint: { ...conversation.endpoint, adapter: 'plugin:other' } };

    expect(conversationRefKey(conversation)).not.toBe(conversationRefKey(changedThread));
    expect(conversationRefKey(conversation)).not.toBe(conversationRefKey(changedOwner));
  });

  it('enforces contiguous revisions, non-decreasing anchors and payload-sensitive replay', async () => {
    const conversation = baseConversation();
    const conversationKey = conversationRefKey(conversation);
    const repository = new MemoryInteractionSpaceBindingRepository();
    const first = createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 10,
      space: 'workroom',
      projectId: 'project:zhin',
      sourceRef: 'registry:1',
      sourceDigest: `sha256:${'4'.repeat(64)}`,
    });
    await repository.append(conversationKey, 0, [first]);
    await expect(repository.append(conversationKey, 0, [first])).resolves.toHaveLength(1);

    await expect(repository.append(conversationKey, 1, [createInteractionSpaceBinding({
      conversation,
      bindingRevision: 2,
      effectiveAfterConversationSequence: 9,
      space: 'chat',
      sourceRef: 'registry:2',
      sourceDigest: `sha256:${'5'.repeat(64)}`,
    })])).rejects.toThrow(/anchor/iu);

    await expect(repository.append(conversationKey, 1, [createInteractionSpaceBinding({
      conversation,
      bindingRevision: 2,
      effectiveAfterConversationSequence: 10,
      space: 'chat',
      sourceRef: 'registry:2',
      sourceDigest: `sha256:${'5'.repeat(64)}`,
    })])).resolves.toHaveLength(1);
    const router = new InteractionSpaceRouter(repository);
    await expect(router.resolve({ conversation, conversationSequence: 10 }))
      .resolves.toMatchObject({ status: 'ignored', bindingRevision: 2 });
    await expect(router.resolve({ conversation, conversationSequence: 11 }))
      .resolves.toMatchObject({ status: 'resolved', space: 'chat', bindingRevision: 2 });

    await expect(repository.append(conversationKey, 0, [createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 10,
      space: 'sponsor_room',
      projectId: 'project:zhin',
      sourceRef: 'registry:1',
      sourceDigest: `sha256:${'4'.repeat(64)}`,
    })])).rejects.toThrow(/conflict/iu);
  });

  it('rejects forged digests, foreign address bindings and Project-less Workroom spaces', async () => {
    const conversation = baseConversation();
    const conversationKey = conversationRefKey(conversation);
    expect(() => createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 1,
      space: 'workroom',
      sourceRef: 'registry:1',
      sourceDigest: `sha256:${'6'.repeat(64)}`,
    })).toThrow(/projectId/iu);

    const repository = new MemoryInteractionSpaceBindingRepository();
    const binding = createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 1,
      space: 'chat',
      sourceRef: 'registry:1',
      sourceDigest: `sha256:${'7'.repeat(64)}`,
    });
    await expect(repository.append(conversationRefKey({ ...conversation, threadId: 'issue:other' }), 0, [binding]))
      .rejects.toThrow(/conversation/iu);
    await expect(repository.append(conversationKey, 0, [{ ...binding, digest: `sha256:${'9'.repeat(64)}` }]))
      .rejects.toThrow(/digest/iu);
    await expect(repository.append(conversationKey, 0, [{ ...binding, metadata: { approved: true } } as never]))
      .rejects.toThrow(/unknown/iu);
    await expect(repository.append(conversationKey, 0, [{ ...binding, projectId: {} } as never]))
      .rejects.toThrow(/projectId/iu);
  });

  it('rejects non-canonical ConversationRef aliases and accepts a zero sequence barrier', async () => {
    const conversation = baseConversation();
    const router = new InteractionSpaceRouter(new MemoryInteractionSpaceBindingRepository());
    await expect(router.resolve({
      conversation: { ...conversation, id: `${conversation.id} ` },
      conversationSequence: 1,
    })).rejects.toThrow(/canonical text/iu);

    const binding = createInteractionSpaceBinding({
      conversation,
      bindingRevision: 1,
      effectiveAfterConversationSequence: 0,
      space: 'workroom',
      projectId: 'project:zhin',
      sourceRef: 'registry:zero',
      sourceDigest: `sha256:${'a'.repeat(64)}`,
    });
    const repository = new MemoryInteractionSpaceBindingRepository();
    await repository.append(conversationRefKey(conversation), 0, [binding]);
    await expect(new InteractionSpaceRouter(repository).resolve({
      conversation,
      conversationSequence: 1,
    })).resolves.toMatchObject({ status: 'resolved', space: 'workroom' });
  });
});
