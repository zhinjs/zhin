import { describe, expect, it, vi } from 'vitest';
import { personalSessionIdentity } from '@zhin.js/agent/personal-session';
import { Message } from '@zhin.js/core/runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { createRuntimeTurnAccess, createRuntimeTurnRequest, runtimeImSessionKey,
  runtimePersonalSessionAddress, runtimeSceneTaskSessionKey } from '../../../../src/plugin-runtime/agent/turn/request.js';

const roles = { isMaster: false, isTrusted: false };
const conversation: ConversationRef = {
  endpoint: { adapter: 'root', id: 'root\0zhin.adapter\0qq' }, kind: 'group', id: 'group',
  parent: { kind: 'group', id: 'guild' }, threadId: 'thread',
};
function message(subjectId = 'alice', account = 'account-a', target = conversation) {
  return new Message(
    {
      conversation: target,
      content: '#hello',
      sender: { id: subjectId },
      metadata: {},
      message: { conversation: target, id: 'm1' },
      endpointId: account,
    },
    { generation: 1, reply: async () => ({ status: 'sent' as const }) },
  );
}
function request(source = message(), projectRoot = '/host-a') {
  return createRuntimeTurnRequest({ message: source, text: 'hello', roles }, {
    traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
    projectRoot, workspaceRoot: '/tool-workspace', ports: {}, intent: { kind: 'new' },
  });
}

describe('real IM personal Session request mapping', () => {
  it('uses the trusted Host root and actual endpoint instance with the canonical conversation', () => {
    const source = message();
    const mapped = request(source);
    const address = runtimePersonalSessionAddress(createRuntimeTurnAccess(source, roles), '/host-a');
    expect(address).toEqual({ rootId: '/host-a', platform: 'qq', endpoint: 'account-a', conversation, subjectId: 'alice' });
    expect(mapped.session).toEqual({ key: personalSessionIdentity(address).key, personal: address });
    expect(mapped.policy.filesystem?.workspaceRoot).toBe('/tool-workspace');
    expect(Object.isFrozen(mapped.session.personal?.conversation.endpoint)).toBe(true);
    expect(mapped.session.key).not.toBe('qq:account-a:group:group');
  });

  it('isolates Host, account, canonical endpoint, person, parent and thread', () => {
    const baseline = request();
    const cases = [
      request(message(), '/host-b'), request(message('alice', 'account-b')), request(message('bob')),
      request(message('alice', 'account-a', { ...conversation, endpoint: { ...conversation.endpoint, id: 'root\0zhin.adapter\0qq-b' } })),
      request(message('alice', 'account-a', { ...conversation, parent: { kind: 'group', id: 'other-guild' } })),
      request(message('alice', 'account-a', { ...conversation, threadId: 'other-thread' })),
    ];
    expect(new Set([baseline, ...cases].map(item => item.session.key)).size).toBe(7);
    expect(request().session.key).toBe(baseline.session.key);
  });

  it('does not grant authority through a supplied session key or metadata', () => {
    const source = message();
    const alice = request(source);
    const bobAddress = runtimePersonalSessionAddress(createRuntimeTurnAccess(message('bob'), roles), '/host-a');
    expect(() => createRuntimeTurnRequest({ message: source, text: 'hello', roles }, {
      traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
      projectRoot: '/host-a', workspaceRoot: '/tool-workspace', ports: {}, intent: { kind: 'new' },
      sessionKey: alice.session.key, personalSession: bobAddress,
    })).toThrow('authenticated ingress address');
  });

  it('requires explicit trusted Host context and a canonical conversation', () => {
    const access = createRuntimeTurnAccess(message(), roles);
    expect(() => runtimeImSessionKey(access, '')).toThrow('trusted Host');
    expect(() => runtimePersonalSessionAddress({ ...access, origin: { kind: 'im', platform: 'qq', endpoint: 'bot', scope: 'group', sceneId: 'g' } }, '/host-a')).toThrow('canonical conversation');
  });

  it('uses scene identity independently of participants and excludes personal owner data', () => {
    const alice = createRuntimeTurnAccess(message(), roles);
    const bob = createRuntimeTurnAccess(message('bob'), roles);
    const sceneKey = runtimeSceneTaskSessionKey(alice, '/host-a');
    expect(runtimeSceneTaskSessionKey(bob, '/host-a')).toBe(sceneKey);
    expect(runtimeSceneTaskSessionKey(alice, '/host-b')).not.toBe(sceneKey);
    expect(runtimeSceneTaskSessionKey(createRuntimeTurnAccess(message('alice', 'account-b'), roles), '/host-a')).not.toBe(sceneKey);
    const mapped = createRuntimeTurnRequest({ message: message(), text: 'scene input', roles }, {
      traceId: 'trace', turnId: 'turn', signal: new AbortController().signal,
      projectRoot: '/host-a', workspaceRoot: '/tool-workspace', ports: {}, intent: { kind: 'new' }, sessionKey: sceneKey,
    });
    expect(mapped.session).toEqual({ key: sceneKey });
  });

  it('keeps public context consumption separate for personal and system sessions', async () => {
    const read = vi.fn(async (_consumer: string, _signal: AbortSignal) => ({ blocks: [], cursor: 8 }));
    const commit = vi.fn(async (_consumer: string, _cursor: number) => undefined);
    const source = message();
    const signal = new AbortController().signal;
    const sceneKey = runtimeSceneTaskSessionKey(createRuntimeTurnAccess(source, roles), '/host-a');
    for (const sessionKey of [undefined, sceneKey]) {
      const mapped = createRuntimeTurnRequest({ message: source, text: 'hello', roles }, {
        traceId: 'trace', turnId: 'turn', signal, projectRoot: '/host-a', workspaceRoot: '/tool-workspace',
        ports: {}, intent: { kind: 'new' }, sessionKey, readConversationContext: read, commitConversationContext: commit,
      });
      await mapped.ports.conversationContext!.readPending(signal);
      await mapped.ports.conversationContext!.commit(8);
      expect(read).toHaveBeenLastCalledWith(`agent-session:${mapped.session.key}`, signal);
      expect(commit).toHaveBeenLastCalledWith(`agent-session:${mapped.session.key}`, 8);
    }
    expect(read.mock.calls[0]![0]).not.toBe(read.mock.calls[1]![0]);
  });
});
