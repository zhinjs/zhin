import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Adapter, Plugin } from '../src/index.js';
import type { EndpointConfigRecord, EndpointManager, ProvisionContext } from '../src/built/endpoint-manager.js';
import { EndpointLifecycleService } from '../src/built/endpoint-lifecycle-service.js';

class MockEndpointManager implements EndpointManager {
  addResult: EndpointConfigRecord = { context: 'mock', name: 'bot1', token: 'x' };
  addCalls = 0;

  supportsProvision() { return true; }
  listEndpoints() { return []; }
  async addEndpoint(_ctx: ProvisionContext) {
    this.addCalls++;
    return { ...this.addResult };
  }
  async editEndpoint(name: string, _ctx: ProvisionContext) {
    return { context: 'mock', name, token: 'edited' };
  }
  async removeEndpoint(_name: string) { return true; }
  async startEndpoint(_name: string, _ctx: ProvisionContext) {}
  async stopEndpoint(_name: string) { return true; }
}

class MockAdapter extends Adapter {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  readonly manager = new MockEndpointManager();

  createEndpoint(config: { name: string }) {
    const endpoint = {
      $id: config.name,
      $config: config,
      $connected: false,
      async $connect() {
        endpoint.$connected = true;
      },
      async $disconnect() {
        endpoint.$connected = false;
      },
    };
    return endpoint as never;
  }

  override getEndpointManager() {
    return this.manager;
  }
}

function createConfigFeature(endpoints: EndpointConfigRecord[] = []) {
  const loader = {
    patchKey: vi.fn(),
    load: vi.fn(),
  };
  return {
    primaryFile: 'zhin.config.yml',
    configs: new Map([['zhin.config.yml', loader]]),
    getRaw: () => ({ endpoints: [...endpoints] }),
    loader,
  };
}

describe('EndpointLifecycleService', () => {
  let root: Plugin;
  let adapter: MockAdapter;
  let configFeature: ReturnType<typeof createConfigFeature>;
  let service: EndpointLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    root = new Plugin('/test/root.ts');
    adapter = new MockAdapter(new Plugin('/plugins/mock/index.ts', root), 'mock', []);
    configFeature = createConfigFeature();
    root.provide({ name: 'config', description: 'test', value: configFeature });
    root.provide({
      name: 'mock',
      description: 'mock adapter',
      value: adapter,
    });
    root.adapters.push('mock');
    service = new EndpointLifecycleService(root);
  });

  it('add persists config and connects endpoint', async () => {
    const message = {
      $reply: vi.fn(),
    } as never;
    const result = await service.add('mock', message);
    expect(result.message).toMatch(/已添加并连接/);
    expect(configFeature.loader.patchKey).toHaveBeenCalledWith(
      'endpoints',
      [{ context: 'mock', name: 'bot1', token: 'x' }],
    );
    expect(configFeature.loader.load).toHaveBeenCalled();
    expect(adapter.endpoints.has('bot1')).toBe(true);
  });

  it('add rejects duplicate name in config', async () => {
    configFeature = createConfigFeature([{ context: 'mock', name: 'bot1' }]);
    root.provide({ name: 'config', description: 'test', value: configFeature });
    service = new EndpointLifecycleService(root);
    await expect(service.add('mock', {} as never)).rejects.toThrow(/已存在/);
  });

  it('stop disconnects runtime without removing config', async () => {
    adapter.endpoints.set('bot1', {
      $id: 'bot1',
      $connected: true,
      $disconnect: vi.fn(async () => {}),
    } as never);
    const result = await service.stop('mock', 'bot1');
    expect(result.message).toMatch(/已断开/);
    expect(adapter.endpoints.has('bot1')).toBe(false);
    expect(configFeature.loader.patchKey).not.toHaveBeenCalled();
  });

  it('remove stops runtime and splices config', async () => {
    configFeature = createConfigFeature([{ context: 'mock', name: 'bot1', token: 'x' }]);
    root.provide({ name: 'config', description: 'test', value: configFeature });
    service = new EndpointLifecycleService(root);
    adapter.endpoints.set('bot1', {
      $id: 'bot1',
      $connected: true,
      $disconnect: vi.fn(async () => {}),
    } as never);
    const result = await service.remove('mock', 'bot1');
    expect(result.message).toMatch(/已从配置移除/);
    expect(configFeature.loader.patchKey).toHaveBeenCalledWith('endpoints', []);
  });
});
