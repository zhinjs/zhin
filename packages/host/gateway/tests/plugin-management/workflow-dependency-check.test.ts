import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginManagementWorkflow } from '../../src/plugin-management/workflow.js';

const manifest = { protocol: 1, type: 'plugin', entry: './plugin.js', platformFeatures: false, features: [], plugins: [] };

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'zhin-workflow-deps-')));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'bot', version: '1.0.0', zhin: manifest, dependencies: { reminder: '1.0.0', rss: '1.0.0' } }));
  await writeFile(join(root, 'plugin.js'), 'export default {};');
  await installPlugin('reminder');
  await installPlugin('rss');
  await writeFile(join(root, 'zhin.config.json'), JSON.stringify({ configVersion: 2, plugins: { reminder: 'reminder', rss: 'rss' }, reminder: {}, rss: {} }));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function installPlugin(name: string, extra: Record<string, unknown> = {}) {
  const directory = join(root, 'node_modules', name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', zhin: { ...manifest, ...extra } }));
  await writeFile(join(directory, 'plugin.js'), 'export default {};');
}

describe('project-wide dependency check', () => {
  it('passes once for a healthy project; inspect can leave it out', async () => {
    const workflow = new PluginManagementWorkflow(root);
    expect(await workflow.checkDependencies()).toEqual({ status: 'passed' });
    expect(await workflow.inspect('reminder')).toMatchObject({ dependencies: 'passed', issues: [] });
    expect(await workflow.inspect('reminder', { dependencies: 'skip' })).toMatchObject({ dependencies: 'unchecked', issues: [] });
  });

  it('reports a broken graph once instead of on every plugin when inspect skips it', async () => {
    // reminder references a child plugin that is not installed: the whole project graph fails.
    await installPlugin('reminder', { plugins: ['ghost'] });
    const workflow = new PluginManagementWorkflow(root);
    const check = await workflow.checkDependencies();
    expect(check.status).toBe('failed');
    // Without skipping, the healthy rss plugin carries the project-wide failure as its own.
    const full = await workflow.inspect('rss');
    expect(full).toMatchObject({ dependencies: 'failed', status: 'degraded', issues: [check.status === 'failed' ? check.error : ''] });
    const skipped = await workflow.inspect('rss', { dependencies: 'skip' });
    expect(skipped).toMatchObject({ dependencies: 'unchecked', issues: [] });
    expect(skipped.status).not.toBe('degraded');
  });
});
