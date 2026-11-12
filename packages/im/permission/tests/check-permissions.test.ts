import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { checkPermissions, PermissionHost, permissionHostToken } from '../src/index.js';

describe('shared permission admission', () => {
  it('denies identity-empty subjects before invoking a permissive custom checker', async () => {
    const resources = new Scope(rootPluginId());
    const host = new PermissionHost();
    const checker = vi.fn(() => true);
    host.register('platform:admin', checker);
    resources.provide(permissionHostToken, host);
    const context = { use: resources.use.bind(resources) };
    await expect(checkPermissions(context, ['platform:admin'])).resolves.toBe(false);
    await expect(checkPermissions(context, ['platform:admin'], {})).resolves.toBe(false);
    expect(checker).not.toHaveBeenCalled();
  });

  it('denies missing hosts', async () => {
    const resources = new Scope(rootPluginId());
    const context = { input: { sender: { id: 'alice', chatRole: 'owner' } }, use: resources.use.bind(resources) };
    await expect(checkPermissions(context, ['owner'])).resolves.toBe(false);
    await expect(checkPermissions(context, [])).resolves.toBe(true);
    await expect(checkPermissions({ input: context.input, use: () => undefined as never }, ['owner']))
      .resolves.toBe(false);
    resources.provide(permissionHostToken, new PermissionHost());
    await expect(checkPermissions(context, ['owner'])).resolves.toBe(true);
  });

  it('delegates message filters to the same host used by commands', async () => {
    const resources = new Scope(rootPluginId());
    const host = new PermissionHost();
    resources.provide(permissionHostToken, host);
    const input = {
      conversation: { endpoint: { adapter: 'root/icqq', id: 'bot' }, kind: 'group', id: 'team' },
      sender: { id: 'alice', chatRole: 'owner', platform: { standing: 'member' } },
    };
    const context = { input, use: resources.use.bind(resources) };
    await expect(checkPermissions(context, ['group(team)', 'user(alice)', 'role(trusted)'])).resolves.toBe(true);
    await expect(checkPermissions(context, ['private()', 'owner'])).resolves.toBe(false);
    await expect(checkPermissions(context, ['platform:admin'])).resolves.toBe(false);
    await expect(checkPermissions(context, ['user(bob)'])).resolves.toBe(false);
  });

  it('rejects removed and unknown permit spellings before checking', async () => {
    const resources = new Scope(rootPluginId());
    resources.provide(permissionHostToken, new PermissionHost());
    const context = { use: resources.use.bind(resources) };
    await expect(checkPermissions(context, ['role(master)'])).rejects.toThrow('use role(owner)');
    await expect(checkPermissions(context, ['platform(icqq,ban)'])).rejects.toThrow('use platform-permission:ban');
    await expect(checkPermissions(context, ['unregistered'])).rejects.toThrow('Unknown permit');
    await expect(checkPermissions(context, [])).resolves.toBe(true);
  });
});
