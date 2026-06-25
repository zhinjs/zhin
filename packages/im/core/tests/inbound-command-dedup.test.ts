import { describe, it, expect, vi } from 'vitest';
import { Plugin } from '../src/plugin.js';
import { CommandFeature } from '../src/built/command.js';
import { MessageCommand } from '../src/command.js';
import { createMessageDispatcher } from '../src/built/dispatcher.js';
import { runInboundMessage } from '../src/built/inbound-runner.js';
import { Adapter, type Endpoint } from '../src/adapter.js';

class MockEndpoint implements Endpoint {
  $id = 'bot1';
  $connected = true;
  constructor(public adapter: MockAdapter) {}
  async $sendMessage() {
    return '1';
  }
  async $connect() {}
  async $disconnect() {}
}

class MockAdapter extends Adapter<MockEndpoint> {
  sendCalls: unknown[] = [];
  constructor(plugin: Plugin) {
    super(plugin, 'test' as never, [{ id: 'bot1' }]);
    this.endpoints.set('bot1', new MockEndpoint(this));
  }
  createEndpoint(): MockEndpoint {
    return new MockEndpoint(this);
  }
  override async sendMessage(options: Parameters<Adapter['sendMessage']>[0]) {
    this.sendCalls.push(options.content);
    return super.sendMessage(options);
  }
}

describe('inbound command reply dedup', () => {
  it('命令回复只应发出一次（middleware + dispatcher 不重复）', async () => {
    const plugin = new Plugin('/test/plugin.ts');
    const commandService = new CommandFeature();
    commandService.add(
      new MessageCommand('/qbot status').action(() => 'STATUS-ONCE'),
      'qq',
    );
    plugin.provide(commandService);
    const adapter = new MockAdapter(plugin);
    plugin.provide({
      name: 'test',
      description: 'test adapter',
      value: adapter,
    } as never);
    const dispatcherCtx = createMessageDispatcher();
    plugin.provide(dispatcherCtx);
    dispatcherCtx.mounted?.({ root: plugin } as Plugin);

    const replySpy = vi.fn(async (content: unknown) => {
      await adapter.sendMessage({
        context: 'test',
        endpoint: 'bot1',
        content: content as never,
        id: 'u1',
        type: 'private',
      });
      return 'mid';
    });

    const message = {
      $adapter: 'test',
      $endpoint: 'bot1',
      $content: [{ type: 'text', data: { text: '/qbot status' } }],
      $sender: { id: 'u1' },
      $channel: { id: 'u1', type: 'private' },
      $reply: replySpy,
    };

    await runInboundMessage({
      plugin,
      message: message as never,
      emitAdapterObservers: () => {},
    });

    expect(replySpy).toHaveBeenCalledTimes(1);
    expect(replySpy).toHaveBeenCalledWith('STATUS-ONCE');
    expect(adapter.sendCalls).toHaveLength(1);
  });
});
