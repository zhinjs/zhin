import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigDocument } from '@zhin.js/config-file';
import { HOST_CONFIG_PATCH_PATHS, type ConsoleConfigApplication } from '@zhin.js/console-protocol';
import { ConfigValidationError } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';
import { maskConfigValue, REDACTED_CONFIG_VALUE } from '../../../src/plugin-runtime/console/configuration-redaction.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const schema = { type: 'object', additionalProperties: false, $defs: { hidden: { type: 'string', 'x-zhin-config': { secret: true } } },
  properties: { label: { type: 'string' }, password: { type: 'string', writeOnly: true }, endpoint: { type: 'string' },
    nested: { type: 'object', properties: { apiKey: { type: 'string' }, color: { type: 'string' }, ref: { $ref: '#/$defs/hidden' } } },
    list: { type: 'array', items: { type: 'string' } } } };
const initial = { label: 'before', password: 'private-literal', endpoint: '${PRIVATE_ENDPOINT}',
  nested: { apiKey: 'private-key', color: 'blue', ref: 'private-ref' }, list: ['public', '${PRIVATE_ITEM}'] };

async function fixture(overrides: Partial<ConstructorParameters<typeof ConsoleConfigurationStore>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-project-config-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'project-fixture', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  for (const name of ['demo', 'other']) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'package.json'), JSON.stringify({ name: `@fixture/${name}`, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
    await writeFile(join(root, name, 'schema.json'), JSON.stringify(schema));
  }
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify({ configVersion: 2, plugins: { demo: './demo' }, demo: initial }));
  const document = createConfigDocument(file);
  const store = new ConsoleConfigurationStore({ projectRoot: root, document, environmentForPlugin: () => ({ has: () => true }), ...overrides });
  return { root, file, store, document };
}
const set = (path: string[], value: unknown) => ({ op: 'set' as const, path, value });

describe('ordinary config:patch scope stays byte-stable', () => {
  it('pins HOST_CONFIG_PATCH_PATHS to the page allowlist', () => {
    expect(HOST_CONFIG_PATCH_PATHS).toEqual([['ai', 'trigger', 'ambient']]);
    expect(Object.isFrozen(HOST_CONFIG_PATCH_PATHS)).toBe(true);
    expect(HOST_CONFIG_PATCH_PATHS.every(path => Object.isFrozen(path))).toBe(true);
  });

  it('still rejects paths outside the page allowlist while the trusted path saves them', async () => {
    const f = await fixture();
    const { revision } = await f.store.readSource();
    const request = { expectedRevision: revision, patches: [set(['demo', 'label'], 'after')] };
    await expect(f.store.patch(request)).rejects.toThrow('Host 白名单');
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('before');
    expect(await f.store.patchProject(request)).toMatchObject({ status: 'saved', paths: [['demo', 'label']] });
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('after');
  });

  it('keeps raw conflict values on the ordinary allowlisted path', async () => {
    const f = await fixture();
    const before = JSON.parse(await readFile(f.file, 'utf8'));
    await writeFile(f.file, JSON.stringify({ ...before, ai: { trigger: { ambient: { mode: '${RAW_FOR_PAGE}' } } } }));
    const result = await f.store.patch({ expectedRevision: 'f'.repeat(64), patches: [set(['ai', 'trigger', 'ambient', 'mode'], 'active')] });
    expect(result).toMatchObject({ status: 'conflict', current: [{ path: ['ai', 'trigger', 'ambient', 'mode'], value: '${RAW_FOR_PAGE}' }] });
  });
});

describe('trusted project patch (config:patch-project)', () => {
  it('validates and applies one complete candidate across sections under a single CAS', async () => {
    const validateConfiguration = vi.fn(async () => undefined);
    const applyConfiguration = vi.fn(async (revision?: string): Promise<ConsoleConfigApplication> => ({ operationId: 'config:1234:1', sourceRevision: revision!, saved: true,
      generation: 2, applicationRevision: 1, groups: [] }));
    const f = await fixture({ validateConfiguration, applyConfiguration });
    const { revision } = await f.store.readSource();
    const result = await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'after'), set(['ai', 'enabled'], true)] });
    expect(result).toMatchObject({ status: 'saved', paths: [['demo', 'label'], ['ai', 'enabled']] });
    expect(validateConfiguration).toHaveBeenCalledTimes(1);
    expect(applyConfiguration).toHaveBeenCalledTimes(1);
    expect(applyConfiguration).toHaveBeenCalledWith((result as { revision: string }).revision);
    expect(JSON.parse(await readFile(f.file, 'utf8'))).toMatchObject({ demo: { label: 'after' }, ai: { enabled: true } });
    // The consumed revision cannot be reused: the second write is a conflict, not an overwrite.
    expect(await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'again')] })).toMatchObject({ status: 'conflict' });
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('after');
  });

  it.each([
    [['plugins', 'new'], './other'],
    [['plugins'], { demo: './other' }],
    [['disable_plugins'], ['demo']],
    [['configVersion'], 2],
    [['plugin', 'commandNamespace'], 'x'],
    [['undeclared'], { label: 'after' }],
  ])('rejects declaration path %j as structured invalid without writing', async (path, value) => {
    const f = await fixture();
    const { revision } = await f.store.readSource();
    const before = await readFile(f.file, 'utf8');
    const result = await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'after'), set(path, value)] });
    expect(result).toMatchObject({ status: 'invalid', revision, errors: [{ path: `$.${path[0]}` }], missingEnv: [] });
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });

  it('rejects declaration removal too', async () => {
    const f = await fixture();
    const { revision } = await f.store.readSource();
    expect(await f.store.patchProject({ expectedRevision: revision, patches: [{ op: 'remove', path: ['plugins', 'demo'] }] }))
      .toMatchObject({ status: 'invalid', errors: [{ path: '$.plugins' }] });
  });

  it('masks secret, writeOnly, $ref secret, secret-like keys and ${…} references in conflict values', async () => {
    const f = await fixture();
    const result = await f.store.patchProject({ expectedRevision: 'f'.repeat(64), patches: [
      set(['demo', 'label'], 'x'), set(['demo', 'password'], 'x'), set(['demo', 'endpoint'], 'x'),
      set(['demo', 'nested'], {}), set(['demo', 'list'], []),
    ] });
    expect(result.status).toBe('conflict');
    const current = (result as { current: Array<{ path: string[]; value: unknown }> }).current;
    expect(current.map(entry => entry.value)).toEqual([
      'before', REDACTED_CONFIG_VALUE, REDACTED_CONFIG_VALUE,
      { apiKey: REDACTED_CONFIG_VALUE, color: 'blue', ref: REDACTED_CONFIG_VALUE },
      ['public', REDACTED_CONFIG_VALUE],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private-|PRIVATE_/u);
  });

  it('returns ConfigValidationError as structured invalid without echoing issue text', async () => {
    const f = await fixture({ validateConfiguration: async () => { throw new ConfigValidationError(['synthetic-private-credential']); } });
    const { revision } = await f.store.readSource();
    const before = await readFile(f.file, 'utf8');
    const result = await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'after')] });
    expect(result).toMatchObject({ status: 'invalid', errors: [{ path: '$' }] });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-credential');
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });

  it('reports schema errors as invalid and keeps saved + applicationError when apply throws', async () => {
    const f = await fixture({ applyConfiguration: async () => { throw new Error('synthetic apply failure'); } });
    const { revision } = await f.store.readSource();
    expect(await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 1)] })).toMatchObject({ status: 'invalid' });
    expect(await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'after')] }))
      .toMatchObject({ status: 'saved', applicationError: 'unconfirmed' });
  });

  it('preserves commit uncertainty and the attempted revision after the file was written', async () => {
    const applyConfiguration = vi.fn(async (): Promise<ConsoleConfigApplication> => { throw new Error('must not apply without commit acknowledgement'); });
    const f = await fixture({ applyConfiguration });
    const { revision } = await f.store.readSource();
    const prepare = f.document.prepare.bind(f.document); let commits = 0; let rollbacks = 0;
    vi.spyOn(f.document, 'prepare').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      return { ...prepared, commit: async () => { commits++; await prepared.commit(); throw new Error('private-io-excerpt'); },
        rollback: async () => { rollbacks++; await prepared.rollback(); } };
    });
    const result = await f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'after')] });
    expect(result).toMatchObject({ status: 'unconfirmed', expectedRevision: revision });
    expect(JSON.stringify(result)).not.toContain('private-io-excerpt');
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('after');
    expect(commits).toBe(1); expect(rollbacks).toBe(0); expect(applyConfiguration).not.toHaveBeenCalled();
  });

  it('does not classify a preparation failure before commit as an unconfirmed save', async () => {
    const f = await fixture();
    const { revision } = await f.store.readSource();
    const before = await readFile(f.file, 'utf8');
    vi.spyOn(f.document, 'prepare').mockRejectedValueOnce(new Error('synthetic preparation failure'));
    await expect(f.store.patchProject({ expectedRevision: revision, patches: [set(['demo', 'label'], 'after')] }))
      .rejects.toThrow('synthetic preparation failure');
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });

  it('ordinary patch keeps a thrown commit as a thrown error (no unconfirmed reclassification)', async () => {
    const f = await fixture();
    const { revision } = await f.store.readSource();
    const prepare = f.document.prepare.bind(f.document);
    vi.spyOn(f.document, 'prepare').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      return { ...prepared, commit: async () => { throw new Error('synthetic commit failure'); } };
    });
    await expect(f.store.patch({ expectedRevision: revision, patches: [set(['ai', 'trigger', 'ambient', 'mode'], 'shadow')] }))
      .rejects.toThrow('synthetic commit failure');
  });
});

describe('maskConfigValue', () => {
  it('masks by schema annotation, key name and environment reference', () => {
    expect(maskConfigValue({ type: 'string', format: 'password' }, ['x'], 'v')).toBe(REDACTED_CONFIG_VALUE);
    expect(maskConfigValue({ type: 'object', properties: { a: { 'x-zhin-config': { secret: true } } } }, ['x', 'a'], 'v')).toBe(REDACTED_CONFIG_VALUE);
    expect(maskConfigValue({ anyOf: [{ type: 'string' }, { type: 'string', writeOnly: true }] }, ['x'], 'v')).toBe(REDACTED_CONFIG_VALUE);
    expect(maskConfigValue(null, ['x', 'botToken'], 'v')).toBe(REDACTED_CONFIG_VALUE);
    expect(maskConfigValue(null, ['x'], { maxTokens: 100, accessToken: 't', url: 'env://SECRET' })).toEqual({ maxTokens: 100, accessToken: REDACTED_CONFIG_VALUE, url: REDACTED_CONFIG_VALUE });
    expect(maskConfigValue({ type: 'object', patternProperties: { '^k': { secret: true } } }, ['x'], { k1: 'v', other: 'ok' })).toEqual({ k1: REDACTED_CONFIG_VALUE, other: 'ok' });
  });
});
