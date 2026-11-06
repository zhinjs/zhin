import type { TurnRequest } from '@zhin.js/agent';
import {
  MemoryPersonalSessionRepository,
  PersonalSessionService,
  personalSessionIdentity,
  type PersonalSessionAddress,
} from '@zhin.js/agent/personal-session';
import { resolveInferenceTurnContext } from '@zhin.js/agent/runtime';

function address(): PersonalSessionAddress {
  return {
    rootId: '/root',
    platform: 'qq',
    endpoint: 'account',
    subjectId: 'alice',
    conversation: {
      endpoint: { adapter: 'plugin', id: 'root\0adapter\0qq' },
      kind: 'channel',
      id: 'room',
      parent: { kind: 'group', id: 'guild' },
      threadId: 'topic',
    },
  };
}
function request(personal = address()): TurnRequest {
  return {
    identity: { turnId: 'turn', traceId: 'trace' },
    origin: {
      kind: 'im',
      platform: personal.platform,
      endpoint: personal.endpoint,
      scope: personal.conversation.kind,
      sceneId: personal.conversation.id,
      conversation: personal.conversation,
    },
    principal: { subjectId: personal.subjectId, displayName: 'Alice', roles: ['user'] },
    intent: { kind: 'new' },
    input: { text: 'hello' },
    session: { key: personalSessionIdentity(personal).key, personal },
    policy: { permissions: ['user'], unattended: false },
    signal: new AbortController().signal,
    ports: {},
  };
}
const sessions = () => new PersonalSessionService(new MemoryPersonalSessionRepository());

it('preserves all canonical scene dimensions and excludes presentation names from model policy identity', async () => {
  const original = address(),
    variants: PersonalSessionAddress[] = [
      { ...original, rootId: '/other-root' },
      { ...original, platform: 'another-platform' },
      { ...original, endpoint: 'other-account' },
      {
        ...original,
        conversation: {
          ...original.conversation,
          endpoint: { ...original.conversation.endpoint, adapter: 'other-owner' },
        },
      },
      {
        ...original,
        conversation: {
          ...original.conversation,
          endpoint: { ...original.conversation.endpoint, id: 'other-entry' },
        },
      },
      { ...original, conversation: { ...original.conversation, kind: 'group' } },
      { ...original, conversation: { ...original.conversation, id: 'other-room' } },
      { ...original, conversation: { ...original.conversation, parent: { kind: 'channel', id: 'guild' } } },
      {
        ...original,
        conversation: { ...original.conversation, parent: { kind: 'group', id: 'other-guild' } },
      },
      { ...original, conversation: { ...original.conversation, threadId: 'other-topic' } },
    ];
  const base = await resolveInferenceTurnContext(
    { rootId: original.rootId, hostOwnerId: 'host', sessions: sessions() },
    request(original)
  );
  for (const variant of variants) {
    const context = await resolveInferenceTurnContext(
      { rootId: variant.rootId, hostOwnerId: 'host', sessions: sessions() },
      request(variant)
    );
    expect(context.sceneKey).not.toBe(base.sceneKey);
  }
  const renamed = { ...request(), principal: { ...request().principal, displayName: 'Renamed' } };
  expect(
    await resolveInferenceTurnContext({ rootId: '/root', hostOwnerId: 'host', sessions: sessions() }, renamed)
  ).toEqual(base);
  const dimensions = [
    { ...original, endpoint: 'account\0room', conversation: { ...original.conversation, id: 'tail' } },
    { ...original, endpoint: 'account', conversation: { ...original.conversation, id: 'room\0tail' } },
    { ...original, endpoint: 'account:room', conversation: { ...original.conversation, id: 'tail' } },
    { ...original, endpoint: 'account', conversation: { ...original.conversation, id: 'room:tail' } },
  ];
  const contexts = await Promise.all(
    dimensions.map((personal) =>
      resolveInferenceTurnContext(
        { rootId: '/root', hostOwnerId: 'host', sessions: sessions() },
        request(personal)
      )
    )
  );
  expect(new Set(contexts.map((context) => context.sceneKey)).size).toBe(dimensions.length);
});

it('rejects a personal address that differs from the trusted sender, scene or Host and never reads that forged Session', async () => {
  const service = sessions(),
    read = vi.spyOn(service, 'read'),
    original = request();
  const variants: TurnRequest[] = [
    { ...original, principal: { ...original.principal, subjectId: 'mallory' } },
    { ...original, session: { ...original.session, key: 'forged-key' } },
    {
      ...original,
      origin: {
        ...original.origin,
        kind: 'im',
        platform: 'qq',
        endpoint: 'account',
        scope: 'channel',
        sceneId: 'room',
        conversation: { ...address().conversation, threadId: 'different' },
      },
    },
  ];
  for (const variant of variants)
    await expect(
      resolveInferenceTurnContext({ rootId: '/root', hostOwnerId: 'host', sessions: service }, variant)
    ).rejects.toThrow('trusted turn identity');
  await expect(
    resolveInferenceTurnContext({ rootId: '/other', hostOwnerId: 'host', sessions: service }, original)
  ).rejects.toThrow('trusted turn identity');
  expect(read).not.toHaveBeenCalled();
});
