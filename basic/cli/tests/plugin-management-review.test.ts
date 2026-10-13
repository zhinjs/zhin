import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpHost } from '@zhin.js/host-http';
import { PluginManagementWorkflow } from '../src/plugin-management/workflow.js';
import { installCommand } from '../src/commands/install.js';
import { installNpmPlugin } from '../src/commands/packages.js';
import { resolveInstallRoute } from '../src/utils/plugin-registry.js';
import { logger } from '../src/utils/logger.js';
import { registerConsolePluginRoutes } from '../src/plugin-runtime/console/plugin-routes.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'zhin-management-review-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'review-root', version: '1.0.0', zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, plugins: [] } }));
  await writeFile(join(root, 'zhin.config.json'), '{}');
  return root;
}

describe('reviewed CLI plugin installation paths', () => {
  it('uses the local manifest package name for an absolute install path', async () => {
    const root = await project();
    const local = join(root, 'local');
    await mkdir(local);
    await writeFile(join(local, 'package.json'), JSON.stringify({ name: 'local-plugin' }));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const workflow = new PluginManagementWorkflow(root);
    const plan = await workflow.planInstall('local-plugin');
    const state = await workflow.inspect('local-plugin');
    const install = vi.spyOn(PluginManagementWorkflow.prototype, 'install').mockResolvedValue({ plan, state, restartRequired: false });
    await installCommand.parseAsync(['node', 'zhin', local, '--no-enable']);
    expect(install).toHaveBeenCalledWith('local-plugin', undefined, undefined, expect.objectContaining({ source: local, enable: false }));
  });

  it('rejects CLI save-dev with automatic enable before installing', async () => {
    const root = await project();
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const install = vi.spyOn(PluginManagementWorkflow.prototype, 'install');
    const output = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('CLI exited'); });
    installCommand.setOptionValue('enable', true);
    await expect(installCommand.parseAsync(['node', 'zhin', 'reminder', '--save-dev'])).rejects.toThrow('CLI exited');
    expect(output).toHaveBeenCalledWith(expect.stringContaining('--no-enable'));
    expect(install).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).zhin.plugins).toEqual([]);
  });

  it('prints a dependency-only dry run without claiming declaration or configuration changes', async () => {
    const root = await project();
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const output = vi.spyOn(logger, 'log').mockImplementation(() => {});
    await installNpmPlugin(resolveInstallRoute('reminder'), { dryRun: true, enable: false });
    const plan = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(plan).toMatchObject({ changes: { packageManifest: 'unchanged', config: 'unchanged' }, restartRequired: false });
    expect(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).zhin.plugins).toEqual([]);
  });

  it('preserves adapter setup guidance after the shared installer succeeds', async () => {
    const root = await project();
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    const resolved = resolveInstallRoute('@zhin.js/adapter-telegram');
    const workflow = new PluginManagementWorkflow(root);
    const state = await workflow.inspect('telegram');
    const plan = await workflow.planInstall('@zhin.js/adapter-telegram');
    vi.spyOn(PluginManagementWorkflow.prototype, 'install').mockResolvedValue({ plan, state, restartRequired: false });
    const output = vi.spyOn(logger, 'log').mockImplementation(() => {});
    await installNpmPlugin(resolved, {});
    expect(resolved.adapter?.setupHint).toBeTruthy();
    expect(output).toHaveBeenCalledWith(resolved.adapter?.setupHint);
  });

  it('keeps the plugin list and detail available when one optional inspection fails', async () => {
    const root = await project();
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    manifest.zhin.plugins = [{ package: 'healthy', instanceKey: 'healthy' }, { package: 'broken', instanceKey: 'broken' }];
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest));
    const workflow = new PluginManagementWorkflow(root);
    vi.spyOn(workflow, 'inspect').mockImplementation(async name => { if (name === 'broken') throw new Error('Invalid plugin configuration'); return { ...await new PluginManagementWorkflow(root).inspect('healthy'), status: 'installed' }; });
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    try {
      registerConsolePluginRoutes({ http, base: '/api', projectRoot: root, pluginLifecycleFile: join(root, '.zhin/plugins.json'), pluginManagement: workflow });
      const address = await http.listen();
      const list = await fetch(`http://127.0.0.1:${address.port}/api/plugins`);
      expect(list.status).toBe(200);
      const body = await list.json();
      expect(body.data.find((plugin: { instanceKey: string }) => plugin.instanceKey === 'healthy')).toHaveProperty('management');
      expect(body.data.find((plugin: { instanceKey: string }) => plugin.instanceKey === 'broken')).toMatchObject({ managementError: 'Invalid plugin configuration' });
      const detail = await fetch(`http://127.0.0.1:${address.port}/api/plugins/broken`);
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ data: { managementError: 'Invalid plugin configuration' } });
    } finally { await http.close(); }
  });
});
