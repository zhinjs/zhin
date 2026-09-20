import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPluginManagementPort } from '../src/plugin-runtime/console/plugin-management.js';

describe('Console plugin management planning', () => {
  it('reads the project manifest and reports install/config changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-plan-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@zhin.js/adapter-telegram': '^1.0.0' },
      zhin: { plugins: [] },
    }));

    const plan = await createPluginManagementPort(root).planInstall('@zhin.js/adapter-telegram');
    expect(plan).toMatchObject({
      packageName: '@zhin.js/adapter-telegram',
      alreadyInstalled: true,
      alreadyDeclared: false,
      restartRequired: true,
      changes: { packageManifest: 'add-plugin', config: 'unchanged' },
    });
  });

  it('plans an uninstall from dependency, manifest, and config state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-uninstall-plan-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@zhin.js/adapter-telegram': '^1.0.0' },
      zhin: {
        plugins: [{ package: '@zhin.js/adapter-telegram', instanceKey: 'telegram' }],
      },
    }));
    const port = createPluginManagementPort(root, {
      readConfigDocument: async () => ({ telegram: { endpoints: [] } }),
    });
    await expect(port.planUninstall?.('@zhin.js/adapter-telegram')).resolves.toMatchObject({
      instanceKey: 'telegram',
      installed: true,
      declared: true,
      hasConfig: true,
      restartRequired: true,
    });
  });

  it('plans an exact-version update from the installed package manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-plugin-update-plan-'));
    await writeFile(join(root, 'package.json'), JSON.stringify({
      dependencies: { '@zhin.js/adapter-telegram': '^1.0.0' },
      zhin: { plugins: [{ package: '@zhin.js/adapter-telegram', instanceKey: 'telegram' }] },
    }));
    const installed = join(root, 'node_modules', '@zhin.js', 'adapter-telegram');
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    const plan = await createPluginManagementPort(root)
      .planUpdate?.('@zhin.js/adapter-telegram', '1.1.0');
    expect(plan).toMatchObject({
      currentVersion: '1.0.0',
      targetVersion: '1.1.0',
      installed: true,
      declared: true,
      alreadyCurrent: false,
      restartRequired: true,
    });
  });
});
