import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Plugin, CommandFeature } from '../src/index.js';
import { PermissionFeature } from '../src/built/permission.js';
import { MANAGEMENT_OPERATOR_PERMIT } from '../src/built/management-command-guard.js';
import { registerEndpointManagementCommands } from '../src/built/endpoint-commands.js';
import * as lifecycleModule from '../src/built/endpoint-lifecycle-service.js';

function trustedMsg(text: string) {
  return {
    $content: [{ type: 'text', data: { text } }],
    $sender: { id: '1', isTrusted: true },
    $adapter: 'qq',
    $endpoint: 'zhin',
    $channel: { type: 'group', id: '1' },
  } as never;
}

function untrustedMsg(text: string) {
  return {
    $content: [{ type: 'text', data: { text } }],
    $sender: { id: '9999' },
    $adapter: 'qq',
    $endpoint: 'zhin',
    $channel: { type: 'group', id: '1' },
  } as never;
}

describe('registerEndpointManagementCommands', () => {
  let root: Plugin;
  let plugin: Plugin;
  let commandService: CommandFeature;

  beforeEach(() => {
    root = new Plugin('/test/root.ts');
    root.provide(new PermissionFeature());
    plugin = new Plugin('/packages/im/core/index.ts', root);
    commandService = new CommandFeature();
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers /endpoint and /endpoints without /endpoint list', () => {
    registerEndpointManagementCommands(plugin, commandService);
    const patterns = commandService.items.map((i) => i.pattern);
    expect(patterns).toContain('/endpoint help');
    expect(patterns).toContain('/endpoint add [adapter:word]');
    expect(patterns).toContain('/endpoints');
    expect(patterns.some((p) => p.includes('list'))).toBe(false);
  });

  it('registers all patterns with management operator permit', () => {
    registerEndpointManagementCommands(plugin, commandService);
    for (const item of commandService.items) {
      expect(item.requiredPermits).toContain(MANAGEMENT_OPERATOR_PERMIT);
    }
  });

  it('/endpoint add without adapter lists provisionable adapters', async () => {
    registerEndpointManagementCommands(plugin, commandService);
    const result = await commandService.handle(trustedMsg('/endpoint add'), plugin);
    expect(String(result)).toMatch(/qq/);
  });

  it('denies when sender lacks trusted role', async () => {
    registerEndpointManagementCommands(plugin, commandService);
    const result = await commandService.handle(untrustedMsg('/endpoint help'), plugin);
    expect(result).toBeFalsy();
  });
});
