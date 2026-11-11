import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateModelRuntimeConfig } from '@zhin.js/agent/config';
import { validateOfflineConfiguration } from '../../../../../../basic/cli/src/utils/config-offline.js';

const environment = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../../../host/gateway/src/project/environment.js', () => ({ loadRuntimeEnvironmentLayers: environment.read }));
vi.mock('../../../../../host/gateway/src/config/ai-config-loader.js', () => ({ loadAiConfigUtils: () => ({ validateModelRuntimeConfig }) }));

it.each([
  { providers: { main: { apiKey: '${UNREAD_SECRET}', models: ['native'] } } },
  { providers: { main: { apiKey: '${MISSING_SECRET:-fallback}' } } },
  { modelCatalog: { connections: { main: { secretRef: 'env://UNREAD_SECRET' } } } },
  { modelPolicy: { defaults: { chat: 'retired-preset' } } },
  { agents: { zhin: { provider: 'main', model: 'native' } } },
  { agents: { helper: { preset: 'retired-preset' } } },
  { decisions: { provider: 'retired-plugin' } },
  { imageGeneration: { defaultModel: 'native' } },
  { trigger: { ambient: { judge: ['main/old', 'main/next'] } } },
])('rejects retired startup model authority before reading environment, executing declarations or changing its source: %j', async ai => {
  const root = await mkdtemp(join(tmpdir(), 'inference-startup-boundary-'));
  const source = JSON.stringify({ configVersion: 2, ai });
  const file = join(root, 'zhin.config.json');
  await writeFile(file, source);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'rejected-model-authority', type: 'module',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.mjs', platformFeatures: false } }));
  await writeFile(join(root, 'plugin.mjs'), `import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./declaration-imported', import.meta.url), 'unexpected'); export default {};`);
  environment.read.mockClear();
  try {
    await expect(validateOfflineConfiguration(root, { configVersion: 2, ai }, 'test')).rejects.toThrow('migration required');
    expect(environment.read).not.toHaveBeenCalled();
    await expect(readFile(join(root, 'declaration-imported'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(file, 'utf8')).toBe(source);
  } finally { await rm(root, { recursive: true, force: true }); }
});
