import { describe, expect, it, vi } from 'vitest';
import {
  MemoryPersonalSessionRepository, PersonalSessionAccessError, PersonalSessionRepositoryIntegrityError,
  PersonalSessionRevisionConflictError, PersonalSessionService, personalSessionIdentity,
  type PersonalSessionAddress, type PersonalSessionRepository, personalSessionOwnerId,
} from '../../src/personal-session/index.js';

function address(): PersonalSessionAddress {
  return {
    rootId: 'host-a', platform: 'qq', endpoint: 'account-a', subjectId: 'alice',
    conversation: {
      endpoint: { adapter: 'adapter-a', id: 'endpoint-a' }, kind: 'group', id: 'group-a',
      parent: { kind: 'group', id: 'parent-a' }, threadId: 'thread-a',
    },
  };
}
function access(target = address()) {
  return { address: target, owner: personalSessionIdentity(target).owner };
}

const variations: Array<[string, (input: PersonalSessionAddress) => PersonalSessionAddress]> = [
  ['host', a => ({ ...a, rootId: 'host-b' })],
  ['platform', a => ({ ...a, platform: 'discord' })],
  ['account instance', a => ({ ...a, endpoint: 'account-b' })],
  ['adapter', a => ({ ...a, conversation: { ...a.conversation, endpoint: { ...a.conversation.endpoint, adapter: 'adapter-b' } } })],
  ['endpoint', a => ({ ...a, conversation: { ...a.conversation, endpoint: { ...a.conversation.endpoint, id: 'endpoint-b' } } })],
  ['conversation', a => ({ ...a, conversation: { ...a.conversation, id: 'group-b' } })],
  ['private', a => ({ ...a, conversation: { ...a.conversation, kind: 'private' } })],
  ['channel', a => ({ ...a, conversation: { ...a.conversation, kind: 'channel' } })],
  ['parent', a => ({ ...a, conversation: { ...a.conversation, parent: { kind: 'group', id: 'parent-b' } } })],
  ['parent kind', a => ({ ...a, conversation: { ...a.conversation, parent: { kind: 'channel', id: 'parent-a' } } })],
  ['thread', a => ({ ...a, conversation: { ...a.conversation, threadId: 'thread-b' } })],
  ['principal', a => ({ ...a, subjectId: 'bob' })],
];

describe('PersonalSessionService', () => {
  it.each(variations)('isolates %s in reads and selections', async (_label, change) => {
    const service = new PersonalSessionService(new MemoryPersonalSessionRepository());
    const own = access();
    await service.select({ ...own, expectedRevision: 0, selection: { kind: 'preset', presetId: 'chat-a' } });
    const other = access(change(address()));
    expect((await service.read(other)).selection).toEqual({ kind: 'inherit' });
    await service.select({ ...other, expectedRevision: 0, selection: { kind: 'preset', presetId: 'chat-b' } });
    expect((await service.read(own)).selection).toEqual({ kind: 'preset', presetId: 'chat-a' });
    expect(personalSessionIdentity(own.address).key).not.toBe(personalSessionIdentity(other.address).key);
  });

  it('shares a scene identity across principals while preserving personal identity', () => {
    const alice = personalSessionIdentity(address());
    const bob = personalSessionIdentity({ ...address(), subjectId: 'bob' });
    expect(alice.sceneKey).toBe(bob.sceneKey);
    expect(alice.key).toMatch(/^personal-session:v1:[a-f0-9]{64}$/);
    expect(alice.key).not.toContain('alice');
    expect(personalSessionIdentity({ ...address(), conversation: { ...address().conversation, name: 'New title' } })).toEqual(alice);
  });

  it('isolates catalog ownership across the complete authenticated account scope', () => {
    const owner = personalSessionIdentity(address()).owner;
    const key = personalSessionOwnerId(owner);
    expect(key).toMatch(/^personal-owner:v1:[a-f0-9]{64}$/);
    for (const field of ['rootId', 'platform', 'endpoint', 'adapterId', 'subjectId'] as const) {
      expect(personalSessionOwnerId({ ...owner, [field]: `${owner[field]}-other` })).not.toBe(key);
    }
    const otherScene = personalSessionIdentity({ ...address(), conversation: { ...address().conversation, id: 'other-group' } });
    expect(personalSessionOwnerId(otherScene.owner)).toBe(key);
  });

  it('rejects another owner for reads, preset selection and clearing to inherit', async () => {
    const repository = new MemoryPersonalSessionRepository();
    const service = new PersonalSessionService(repository);
    await service.select({ ...access(), expectedRevision: 0, selection: { kind: 'preset', presetId: 'chat-a' } });
    const read = vi.spyOn(repository, 'read');
    const write = vi.spyOn(repository, 'compareAndSet');
    const attacker = { address: address(), owner: { ...access().owner, subjectId: 'bob' } };
    await expect(service.read(attacker)).rejects.toBeInstanceOf(PersonalSessionAccessError);
    for (const selection of [{ kind: 'inherit' as const }, { kind: 'preset' as const, presetId: 'chat-b' }]) {
      await expect(service.select({ ...attacker, expectedRevision: 1, selection })).rejects.toBeInstanceOf(PersonalSessionAccessError);
    }
    await expect(service.read({ ...access(), owner: { ...access().owner, rootId: 'host-b' } })).rejects.toBeInstanceOf(PersonalSessionAccessError);
    for (const owner of [
      { ...access().owner, platform: 'discord' },
      { ...access().owner, endpoint: 'account-b' },
      { ...access().owner, adapterId: 'another-capability' },
    ]) {
      await expect(service.read({ address: address(), owner })).rejects.toBeInstanceOf(PersonalSessionAccessError);
      await expect(service.select({ address: address(), owner, expectedRevision: 1, selection: { kind: 'inherit' } })).rejects.toBeInstanceOf(PersonalSessionAccessError);
    }
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('commits exactly one simultaneous compare-and-set across service instances', async () => {
    const repository = new MemoryPersonalSessionRepository();
    const first = new PersonalSessionService(repository);
    const second = new PersonalSessionService(repository);
    const results = await Promise.allSettled([first, second].map((service, index) => service.select({
      ...access(), expectedRevision: 0, selection: { kind: 'preset', presetId: `chat-${index}` },
    })));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      name: 'PersonalSessionRevisionConflictError', expectedRevision: 0, actualRevision: 1,
    });
    expect((await first.read(access())).revision).toBe(1);
  });

  it('restores inheritance with CAS and preserves existing snapshots and caller objects', async () => {
    const service = new PersonalSessionService(new MemoryPersonalSessionRepository());
    const target = address();
    const before = JSON.stringify(target);
    const selection = { kind: 'preset' as const, presetId: 'chat-a' };
    const initial = await service.read(access(target));
    const chosen = await service.select({ ...access(target), expectedRevision: 0, selection });
    const inherited = await service.select({ ...access(target), expectedRevision: 1, selection: { kind: 'inherit' } });
    expect(initial).toMatchObject({ revision: 0, selection: { kind: 'inherit' } });
    expect(chosen).toMatchObject({ revision: 1, selection: { kind: 'preset', presetId: 'chat-a' } });
    expect(inherited).toMatchObject({ revision: 2, selection: { kind: 'inherit' } });
    await expect(service.select({ ...access(target), expectedRevision: 1, selection })).rejects.toBeInstanceOf(PersonalSessionRevisionConflictError);
    expect(JSON.stringify(target)).toBe(before);
    expect(Object.isFrozen(target)).toBe(false);
    expect(Object.isFrozen(selection)).toBe(false);
    expect(Object.isFrozen(chosen.selection)).toBe(true);
    expect(Object.isFrozen(chosen.identity.address.conversation.endpoint)).toBe(true);
    expect(Object.isFrozen(chosen.identity.address.conversation.parent)).toBe(true);
    selection.presetId = 'changed';
    expect(chosen.selection).toEqual({ kind: 'preset', presetId: 'chat-a' });
  });

  it('rejects a repository response from another complete session address', async () => {
    const wrong = { identity: personalSessionIdentity({ ...address(), conversation: { ...address().conversation, threadId: 'other' } }), revision: 0, selection: { kind: 'inherit' as const } };
    const repository: PersonalSessionRepository = {
      read: async () => wrong,
      compareAndSet: async () => ({ kind: 'updated', state: wrong }),
    };
    const service = new PersonalSessionService(repository);
    await expect(service.read(access())).rejects.toBeInstanceOf(PersonalSessionRepositoryIntegrityError);
    await expect(service.select({ ...access(), expectedRevision: 0, selection: { kind: 'inherit' } })).rejects.toBeInstanceOf(PersonalSessionRepositoryIntegrityError);
  });

  it('propagates lookup and write failures without absence fallback or retry', async () => {
    const failure = new Error('database unavailable');
    const repository: PersonalSessionRepository = {
      read: vi.fn(async () => { throw failure; }),
      compareAndSet: vi.fn(async () => { throw failure; }),
    };
    const service = new PersonalSessionService(repository);
    await expect(service.read(access())).rejects.toBe(failure);
    await expect(service.select({ ...access(), expectedRevision: 0, selection: { kind: 'inherit' } })).rejects.toBe(failure);
    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.compareAndSet).toHaveBeenCalledTimes(1);
  });

  it('preserves canonical capability NUL ids without delimiter collisions', () => {
    const target = address();
    const left = { ...target, conversation: { ...target.conversation, endpoint: { adapter: 'plugin\0adapter', id: 'entry' } } };
    const right = { ...target, conversation: { ...target.conversation, endpoint: { adapter: 'plugin', id: 'adapter\0entry' } } };
    expect(personalSessionIdentity(left).address.conversation.endpoint.adapter).toBe('plugin\0adapter');
    expect(personalSessionIdentity(left).sceneKey).not.toBe(personalSessionIdentity(right).sceneKey);
    expect(personalSessionIdentity(left).key).not.toBe(personalSessionIdentity(right).key);
  });

  it('rejects empty identity and invalid selection revisions', async () => {
    expect(() => personalSessionIdentity({ ...address(), subjectId: '' })).toThrow(TypeError);
    const service = new PersonalSessionService(new MemoryPersonalSessionRepository());
    await expect(service.select({ ...access(), expectedRevision: -1, selection: { kind: 'inherit' } })).rejects.toThrow(TypeError);
    await expect(service.select({ ...access(), expectedRevision: Number.MAX_SAFE_INTEGER, selection: { kind: 'inherit' } })).rejects.toThrow(TypeError);
    await expect(service.select({ ...access(), expectedRevision: 0, selection: { kind: 'preset', presetId: ' ' } })).rejects.toThrow(TypeError);
    expect((await service.read(access())).revision).toBe(0);
  });
});
