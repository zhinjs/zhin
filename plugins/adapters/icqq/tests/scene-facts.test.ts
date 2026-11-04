import { describe, expect, it, vi } from 'vitest';
import { adapterFeatureId } from '@zhin.js/adapter';
import { resolveRuntimeTurnContextState } from '../../../../basic/cli/src/plugin-runtime/agent/turn/request.js';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));

import definition from '../adapters/icqq/index.js';

/** Scene facts resolve for icqq groups from the REAL profile (no fixture), and stay off in private chats. */
function generation(management: object) {
  const index = {
    $projection: 'zhin.adapter-index/1',
    capabilityProfile: () => definition.profile,
    connection: () => ({ selfUserId: '8596238', management }),
  };
  return { projections: new Map([[adapterFeatureId, index]]) } as never;
}

const management = () => ({
  inspectGroupScene: vi.fn(async () => ({ name: '测试群', memberCount: 3 })),
  inspectGroupMemberProfile: vi.fn(async () => ({ platformRole: 'admin', card: '小智' })),
});

describe('icqq scene facts through its real profile', () => {
  it('queries group info and member profile in a group', async () => {
    const port = management();
    const state = await resolveRuntimeTurnContextState(
      generation(port),
      { endpoint: { id: 'icqq-1', adapter: 'icqq' }, kind: 'group', id: '100' },
      new AbortController().signal,
      '10002',
    );
    expect(port.inspectGroupScene).toHaveBeenCalled();
    expect(port.inspectGroupMemberProfile).toHaveBeenCalled();
    expect(state?.bot).toMatchObject({ id: '8596238', platformRole: 'admin' });
    expect(state?.conversation).toMatchObject({ name: '测试群', memberCount: 3 });
  });

  it('does not query anything in a private chat', async () => {
    const port = management();
    const state = await resolveRuntimeTurnContextState(
      generation(port),
      { endpoint: { id: 'icqq-1', adapter: 'icqq' }, kind: 'private', id: '10002' },
      new AbortController().signal,
      '10002',
    );
    expect(port.inspectGroupScene).not.toHaveBeenCalled();
    expect(state).toEqual({ bot: { id: '8596238' } });
  });
});
