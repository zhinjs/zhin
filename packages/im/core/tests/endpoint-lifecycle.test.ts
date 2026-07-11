import { describe, it, expect, vi } from 'vitest';
import { Plugin } from '../src/plugin.js';
import { Adapter } from '../src/adapter.js';
import type { Endpoint } from '../src/endpoint.js';
import { emitEndpointLifecycle } from '../src/built/endpoint-lifecycle.js';
import { formatSideEventName } from '../src/side-event/base.js';
import { registerEndpointCapabilities } from '../src/endpoint-capabilities.js';

class LifecycleTestEndpoint implements Endpoint {
  $id = 'test-bot';
  $config = { name: 'test-bot' };
  $connected = false;
  $formatMessage() {
    throw new Error('not used');
  }
  async $connect() {
    this.$connected = true;
  }
  async $disconnect() {
    this.$connected = false;
  }
  async $recallMessage() {}
  async $sendMessage() {
    return 'msg-1';
  }
}

class LifecycleTestAdapter extends Adapter<LifecycleTestEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  createEndpoint(): LifecycleTestEndpoint {
    return new LifecycleTestEndpoint();
  }
}

describe('emitEndpointLifecycle', () => {
  it('双通道发射 endpoint.connect 与 notice.receive', async () => {
    const plugin = new Plugin('/test/endpoint-lifecycle.ts');
    const adapter = new LifecycleTestAdapter(plugin, 'process' as never, []);
    const bot = new LifecycleTestEndpoint();
    registerEndpointCapabilities(bot, ['inbound', 'outbound']);

    const pluginDispatch = vi.spyOn(plugin.root, 'dispatch').mockResolvedValue(undefined);
    const noticeSpy = vi.spyOn(adapter, 'emit');

    await emitEndpointLifecycle(plugin, adapter, bot, 'connect');

    expect(pluginDispatch).toHaveBeenCalledWith(
      'endpoint.connect',
      expect.objectContaining({ endpointId: 'test-bot', kind: 'connect' }),
    );
    expect(noticeSpy).toHaveBeenCalledWith(
      'notice.receive',
      expect.objectContaining({
        $type: 'notice',
        $scene_type: 'endpoint',
        $sub_type: 'connect',
      }),
    );
    const notice = noticeSpy.mock.calls[0][1];
    expect(formatSideEventName(notice)).toBe('notice.endpoint.connect');
  });
});
