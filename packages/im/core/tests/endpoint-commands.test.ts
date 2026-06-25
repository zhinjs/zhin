import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Plugin, CommandFeature } from '../src/index.js';
import { registerEndpointManagementCommands } from '../src/built/endpoint-commands.js';
import * as lifecycleModule from '../src/built/endpoint-lifecycle-service.js';
import * as guardModule from '../src/built/management-command-guard.js';

describe('registerEndpointManagementCommands', () => {
  let root: Plugin;
  let plugin: Plugin;
  let commandService: CommandFeature;

  beforeEach(() => {
    root = new Plugin('/test/root.ts');
    plugin = new Plugin('/packages/im/core/index.ts', root);
    commandService = new CommandFeature();
    vi.spyOn(guardModule, 'rejectUnlessManagementOperator').mockReturnValue(null);
    vi.spyOn(lifecycleModule, 'createEndpointLifecycleService').mockReturnValue({
      listProvisionableAdapters: () => ['qq', 'process'],
      add: vi.fn(async () => ({ message: 'added' })),
      remove: vi.fn(async () => ({ message: 'removed' })),
      edit: vi.fn(async () => ({ message: 'edited' })),
      start: vi.fn(async () => ({ message: 'started' })),
      stop: vi.fn(async () => ({ message: 'stopped' })),
      cancelProvision: vi.fn(() => true),
    } as never);
  });

  it('registers /endpoint and /endpoints without /endpoint list', () => {
    registerEndpointManagementCommands(plugin, commandService);
    const patterns = commandService.items.map((i) => i.pattern);
    expect(patterns).toContain('/endpoint help');
    expect(patterns).toContain('/endpoint add [adapter:word]');
    expect(patterns).toContain('/endpoints');
    expect(patterns.some((p) => p.includes('list'))).toBe(false);
  });

  it('/endpoint add without adapter lists provisionable adapters', async () => {
    registerEndpointManagementCommands(plugin, commandService);
    const msg = { $content: [{ type: 'text', data: { text: '/endpoint add' } }] } as never;
    const result = await commandService.handle(msg, plugin);
    expect(String(result)).toMatch(/qq/);
  });

  it('denies when management guard rejects', async () => {
    vi.spyOn(guardModule, 'rejectUnlessManagementOperator').mockReturnValue('DENIED');
    registerEndpointManagementCommands(plugin, commandService);
    const msg = { $content: [{ type: 'text', data: { text: '/endpoint help' } }] } as never;
    expect(await commandService.handle(msg, plugin)).toBe('DENIED');
  });
});
