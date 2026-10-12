import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import { checkPermissions, PermissionHost, permissionHostToken } from '../src/index.js';

describe('shared permission admission', () => {
  it('delegates message filters to the same host used by commands', async () => {
    const resources = new Scope(rootPluginId());
    const host = new PermissionHost();
    resources.provide(permissionHostToken, host);
    const input = {
      conversation: { endpoint: { adapter: 'root/icqq', id: 'bot' }, kind: 'group', id: 'team' },
      sender: { id: 'alice', roles: ['master'] },
    };
    const context = { input, use: resources.use.bind(resources) };
    await expect(checkPermissions(context, ['group(team)', 'user(alice)', 'role(trusted)'])).resolves.toBe(true);
    await expect(checkPermissions(context, ['private()', 'role(master)'])).resolves.toBe(false);
    await expect(checkPermissions(context, ['user(bob)'])).resolves.toBe(false);
  });

  it('keeps platform checking and host calls with no sender explicit', async () => {
    const resources = new Scope(rootPluginId());
    const host = new PermissionHost();
    const checker = vi.fn(() => false);
    host.registerPlatform('icqq', checker);
    resources.provide(permissionHostToken, host);
    const context = { use: resources.use.bind(resources) };
    await expect(checkPermissions(context, ['role(master)'])).resolves.toBe(false);
    await expect(checkPermissions(context, ['platform(icqq,ban)'], {
      adapter: 'icqq', scene: { type: 'group', id: 'g' }, sender: { id: 'alice', role: ['admin'] },
    })).resolves.toBe(false);
    expect(checker).toHaveBeenCalledOnce();
    await expect(checkPermissions(context, [])).resolves.toBe(true);
    await expect(checkPermissions(context, ['unregistered'])).rejects.toThrow('Unknown permit');
  });
});
