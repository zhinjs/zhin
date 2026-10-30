import { afterEach, expect, it, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { loginAssistToken } from '@zhin.js/core/runtime';
import { LoginAssist } from '@zhin.js/core';
import { projectLocaleToken } from 'zhin.js/i18n';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../test-utils/desired-repository.js';

vi.mock('@icqqjs/icqq', async () => import('./_icqq-mock.js'));
import definition from '../adapters/icqq/index.js';
import { IcqqEndpoint } from '../src/endpoint.js';

afterEach(() => vi.restoreAllMocks());

it('acknowledges an account stop from its own inbound handler and applies outside that receive without losing cleanup ownership', async () => {
  const repository = new MemoryDesiredRepository();
  let admitted: unknown;
  let incarnation: IcqqEndpoint | undefined;
  const fixture = await createAdapterHarness(definition, {}, { name: 'icqq', repository,
    resources: new Map([[loginAssistToken.id, new LoginAssist(null)], [projectLocaleToken.id, 'zh-CN']]),
    gateway: { receive: async event => {
      if (event.name !== 'message.receive') return;
      const source = fixture.index.acquireInbound(event.endpoint.id, event.client);
      try {
        const account = fixture.adapter.list()[0]!;
        admitted = await fixture.adapter.stop(account.instanceId, fixture.adapter.revision, { waitForExecution: false });
      } finally { source.release(); }
    } },
  });
  try {
    await fixture.start(); fixture.open();
    const saved = await fixture.adapter.add(fixture.adapter.revision, { endpointId: '10001', config: { id: '10001', autoReconnect: false } });
    await fixture.adapter.start(saved.endpoints[0]!.instanceId, fixture.adapter.revision);
    const endpoint = fixture.endpoint;
    if (!(endpoint instanceof IcqqEndpoint)) throw new Error('Expected the actual ICQQ Client');
    incarnation = endpoint;
    endpoint.emit('message.group.normal', { post_type: 'message', message_type: 'group', group_id: 100, user_id: 2,
      message_id: 'own-stop', raw_message: 'stop', time: 1_700_000_000, sender: { user_id: 2, nickname: 'Bob' } });
    await vi.waitFor(() => expect(admitted).toMatchObject({ execution: { status: 'pending' } }));
    await vi.waitFor(() => expect(fixture.adapter.list()[0]).toMatchObject({ desiredEnabled: false,
      started: false, execution: { action: 'stop', status: 'applied' } }));
    expect(incarnation.terminate).toHaveBeenCalledOnce();
    expect(fixture.adapter.descriptor.owner).toBe(rootPluginId());
  } finally { await fixture.stop(); }
});
