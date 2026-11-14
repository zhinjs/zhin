import { adapterFeatureId } from '@zhin.js/adapter';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import {
  chatIdentityOfPersonalOwner, InferenceManagementError, personalOwnersOfIdentities, resolveInferenceManagementPrincipal,
} from '@zhin.js/agent/runtime';

/** ADR 0060 P3: personal inference owners come from the person ↔ Console links, not from `rootId` in configuration. */
const plugin = 'qq-instance' as never;
function snapshot() {
  const index = {
    $projection: 'zhin.adapter-index/1',
    adapters: () => [{
      descriptor: { id: 'root/plugin/adapter/qq', name: 'qq', source: 'local', owner: plugin, capabilities: [] },
      list: () => [
        { instanceId: 'a', canonicalId: 'qq-cap\0bot-a', endpointId: 'bot-a' },
        { instanceId: 'b', canonicalId: 'qq-cap\0bot-b', endpointId: 'bot-b' },
      ],
    }],
  };
  return {
    tree: new Map([[rootPluginId(), { instanceKey: 'root' }], [plugin, { instanceKey: 'qq' }]]) as never,
    projections: new Map([[adapterFeatureId, index]]) as never,
  };
}

describe('linked personal inference owners', () => {
  it('maps a person\'s identities to one owner per account of the identity\'s adapter, under the current rootId', () => {
    const owners = personalOwnersOfIdentities({ rootId: '/now', snapshot: snapshot(),
      identities: [{ adapter: 'qq', userId: '10001' }, { adapter: 'tg', userId: 'ignored' }] });
    expect(owners).toEqual([
      { rootId: '/now', platform: 'qq', endpoint: 'bot-a', adapterId: 'qq-cap\0bot-a', subjectId: '10001' },
      { rootId: '/now', platform: 'qq', endpoint: 'bot-b', adapterId: 'qq-cap\0bot-b', subjectId: '10001' },
    ]);
    expect(personalOwnersOfIdentities({ rootId: '/now', snapshot: undefined, identities: [{ adapter: 'qq', userId: '1' }] })).toEqual([]);
  });

  it('turns a configured owner into an alias identity whatever its rootId, and leaves unknown adapters unresolved', () => {
    expect(chatIdentityOfPersonalOwner(snapshot(), { adapterId: 'qq-cap\0bot-b', subjectId: '10001' })).toEqual({ adapter: 'qq', userId: '10001' });
    expect(chatIdentityOfPersonalOwner(snapshot(), { adapterId: 'root/plugin/adapter/qq', subjectId: '10001' })).toEqual({ adapter: 'qq', userId: '10001' });
    expect(chatIdentityOfPersonalOwner(snapshot(), { adapterId: 'missing', subjectId: '10001' })).toBeUndefined();
  });

  it('a Console user may switch only to a personal owner of their own linked person (negative)', () => {
    const bindings = (principal: string) => principal === 'user:u1' ? ['personal-u1'] : [];
    expect(resolveInferenceManagementPrincipal({ hostOwnerId: 'host', scope: 'full', principalId: 'user:u1', bindings }))
      .toEqual({ ownerId: 'host', hostAdministrator: true });
    expect(resolveInferenceManagementPrincipal({ hostOwnerId: 'host', scope: 'full', principalId: 'user:u1', requestedOwner: 'personal-u1', bindings }))
      .toEqual({ ownerId: 'personal-u1', hostAdministrator: false });
    // Another user's owner, an unknown owner, or no signed-in user: forbidden.
    expect(() => resolveInferenceManagementPrincipal({ hostOwnerId: 'host', scope: 'full', principalId: 'user:u2', requestedOwner: 'personal-u1', bindings }))
      .toThrow(InferenceManagementError);
    expect(() => resolveInferenceManagementPrincipal({ hostOwnerId: 'host', scope: 'full', requestedOwner: 'personal-u1', bindings }))
      .toThrow(InferenceManagementError);
    // The static map form still works.
    expect(resolveInferenceManagementPrincipal({ hostOwnerId: 'host', scope: 'demo', principalId: 'member', bindings: { member: ['p'] } }))
      .toEqual({ ownerId: 'p', hostAdministrator: false });
  });
});
