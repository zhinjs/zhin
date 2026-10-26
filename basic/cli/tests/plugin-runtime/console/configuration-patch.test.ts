import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { createConfigDocument } from '@zhin.js/config-file';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { ConfigPatchScopeError } from '../../../src/plugin-runtime/console/configuration-patch.js';

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SOURCE = `configVersion: 2
plugins:
  decider: ./decider
  other: ./other
# 用户自己的注释要保留
ai:
  enabled: true
  trigger:
    ambient:
      conversations: ['sandbox:g1']
      mode: active
decider:
  level: 1
other: {}
`;

async function project(patchPaths: unknown = ['ai.decisions']) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-patch-')); tempRoots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'patch-fixture',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  for (const [name, extra] of [['decider', { 'x-zhin-config': { patchPaths } }], ['other', {}]] as const) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'package.json'), JSON.stringify({ name: `@fixture/${name}`,
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(root, name, 'schema.json'), JSON.stringify({
      type: 'object', additionalProperties: false,
      properties: { level: { type: 'integer', minimum: 0, maximum: 5 } }, ...extra,
    }));
  }
  const file = join(root, 'zhin.config.yml');
  await writeFile(file, SOURCE);
  const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(file),
    environmentForPlugin: () => ({ has: () => true }) });
  return { root, file, store };
}

describe('scoped config:patch', () => {
  it('writes one Host allowlisted path, keeps siblings and comments, and asks for restart', async () => {
    const { file, store } = await project();
    const { revision } = await store.readSource();
    const result = await store.patch({ expectedRevision: revision, patches: [
      { op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'shadow' },
    ] });
    expect(result).toMatchObject({ status: 'saved', restartRequired: true, paths: [['ai', 'trigger', 'ambient', 'mode']],
      message: '配置已保存，需重启进程才能生效' });
    const source = await readFile(file, 'utf8');
    expect(source).toContain('# 用户自己的注释要保留');
    expect(parseYaml(source)).toMatchObject({ ai: { enabled: true, trigger: { ambient: { conversations: ['sandbox:g1'], mode: 'shadow' } } }, decider: { level: 1 } });
    expect(result.status === 'saved' && result.revision).toBe((await store.readSource()).revision);
  });

  it('rejects Host paths outside the allowlist without writing', async () => {
    const { file, store } = await project();
    const { revision } = await store.readSource();
    for (const path of [['ai', 'enabled'], ['ai', 'trigger'], ['http', 'port'], ['plugins', 'evil'], ['decider', 'level']]) {
      await expect(store.patch({ expectedRevision: revision, patches: [{ op: 'set', path, value: 1 }] }))
        .rejects.toBeInstanceOf(ConfigPatchScopeError);
    }
    expect(await readFile(file, 'utf8')).toBe(SOURCE);
  });

  it('lets a plugin write its own block (no restart) and the Host sub-path it declares', async () => {
    const { store } = await project();
    let { revision } = await store.readSource();
    const own = await store.patch({ instanceKey: 'decider', expectedRevision: revision, patches: [
      { op: 'set', path: ['decider', 'level'], value: 3 },
    ] });
    expect(own).toMatchObject({ status: 'saved', restartRequired: false, message: '配置已保存' });
    revision = (await store.readSource()).revision;
    const declared = await store.patch({ instanceKey: 'decider', expectedRevision: revision, patches: [
      { op: 'set', path: ['ai', 'decisions'], value: { provider: 'root/decider', skills: { mode: 'shadow' } } },
    ] });
    expect(declared).toMatchObject({ status: 'saved', restartRequired: true });
    const saved = parseYaml((await store.readSource()).source);
    expect(saved.ai).toMatchObject({ enabled: true, decisions: { provider: 'root/decider' }, trigger: { ambient: { mode: 'active' } } });
    expect(saved.decider).toEqual({ level: 3 });
  });

  it('keeps plugins out of other plugins and undeclared Host paths', async () => {
    const { store } = await project();
    const { revision } = await store.readSource();
    const attempts: Array<[string, string[]]> = [
      ['other', ['ai', 'decisions']], ['other', ['decider', 'level']], ['decider', ['ai', 'trigger', 'ambient']],
      ['missing', ['missing', 'x']], ['ai', ['ai', 'decisions']], ['decider', ['decider', '__proto__']],
    ];
    for (const [instanceKey, path] of attempts) {
      await expect(store.patch({ instanceKey, expectedRevision: revision, patches: [{ op: 'set', path, value: {} }] }))
        .rejects.toBeInstanceOf(ConfigPatchScopeError);
    }
  });

  it('returns the latest values instead of overwriting a stale revision', async () => {
    const { file, store } = await project();
    const stale = (await store.readSource()).revision;
    await writeFile(file, SOURCE.replace('mode: active', 'mode: shadow'));
    const result = await store.patch({ expectedRevision: stale, patches: [
      { op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'active' },
      { op: 'remove', path: ['ai', 'trigger', 'ambient', 'judge'] },
    ] });
    expect(result).toMatchObject({ status: 'conflict', revision: (await store.readSource()).revision, current: [
      { path: ['ai', 'trigger', 'ambient', 'mode'], value: 'shadow' },
      { path: ['ai', 'trigger', 'ambient', 'judge'], value: undefined },
    ] });
    expect(await readFile(file, 'utf8')).toContain('mode: shadow');
  });

  it('validates every touched section with its schema before writing', async () => {
    const { file, store } = await project();
    const { revision } = await store.readSource();
    await expect(store.patch({ expectedRevision: revision, patches: [
      { op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'], value: 'loud' },
    ] })).resolves.toMatchObject({ status: 'invalid', revision, errors: [expect.objectContaining({ path: '$.ai.trigger.ambient.mode' })] });
    await expect(store.patch({ instanceKey: 'decider', expectedRevision: revision, patches: [
      { op: 'set', path: ['decider', 'level'], value: 9 },
    ] })).resolves.toMatchObject({ status: 'invalid', errors: [expect.objectContaining({ path: '$.decider.level' })] });
    expect(await readFile(file, 'utf8')).toBe(SOURCE);
  });

  it('rejects malformed operations and invalid patchPaths declarations', async () => {
    const { store } = await project(['http.port']);
    const { revision } = await store.readSource();
    await expect(store.patch({ instanceKey: 'decider', expectedRevision: revision, patches: [{ op: 'set', path: ['decider', 'level'], value: 1 }] }))
      .rejects.toThrow(/patchPaths/);
    for (const patches of [[], [{ op: 'merge', path: ['ai'] }], [{ op: 'set', path: [] , value: 1 }], [{ op: 'set', path: ['ai', 'trigger', 'ambient', 'mode'] }]] as never[]) {
      await expect(store.patch({ expectedRevision: revision, patches })).rejects.toBeInstanceOf(ConfigPatchScopeError);
    }
    for (const declared of [['ai'], ['plugins.x'], ['plugin.x'], 'ai.decisions']) {
      const fixture = await project(declared);
      await expect(fixture.store.patch({ instanceKey: 'decider', expectedRevision: (await fixture.store.readSource()).revision,
        patches: [{ op: 'set', path: ['decider', 'level'], value: 1 }] })).rejects.toThrow(/patchPaths/);
    }
  });
});
