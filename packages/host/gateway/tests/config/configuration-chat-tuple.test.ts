import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../src/config/configuration.js';
import { chatLeafTypes } from '../../src/config/configuration-chat-policy.js';

type Schema = Readonly<Record<string, unknown>>;
const scalar = { type: 'string' };
const object = { type: 'object', properties: { master: scalar }, required: ['master'], additionalProperties: false };
const nestedArray = { type: 'array', items: scalar };
const tuple = (second: Schema): Schema => ({ type: 'array', prefixItems: [scalar, second], items: false, minItems: 2, maxItems: 2 });
const section = (entries: Schema): Schema => ({ type: 'object', properties: { entries }, additionalProperties: false });
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(entriesSchema: Schema, entries: readonly unknown[]) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-chat-tuple-')); roots.push(root);
  await mkdir(join(root, 'demo'));
  for (const directory of [root, join(root, 'demo')]) await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: directory === root ? 'tuple-root' : '@fixture/tuple', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' },
  }));
  await writeFile(join(root, 'demo/schema.json'), JSON.stringify(section(entriesSchema)));
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify({ configVersion: 2, plugins: { demo: './demo' }, demo: { entries } }));
  const document = createConfigDocument(file);
  const apply = vi.fn(async () => ({ operationId: 'config:00000000-0000-0000-0000-000000000000:1', saved: true,
    sourceRevision: (await document.read()).revision, generation: 1, applicationRevision: 1, groups: [] }));
  const store = new ConsoleConfigurationStore({ projectRoot: root, document, applyConfiguration: apply });
  expect((await store.validatePluginConfig('demo', { entries })).valid).toBe(true);
  return { file, document, store, apply };
}

describe('scalar-array chat proof covers every tuple position', () => {
  it.each([
    ['object in second position', tuple(object)],
    ['nested array in second position', tuple(nestedArray)],
    ['object in a later prefix', { type: 'array', prefixItems: [scalar, scalar, object], items: false }],
    ['object tail', { type: 'array', prefixItems: [scalar], items: object }],
    ['nested-array tail', { type: 'array', prefixItems: [scalar], items: nestedArray }],
    ['unconstrained tail', { type: 'array', prefixItems: [scalar] }],
    ['explicitly unconstrained tail', { type: 'array', prefixItems: [scalar], items: true }],
    ['unsafe union', { anyOf: [tuple(scalar), tuple(object)] }],
    ['modern object tail with an obsolete additionalItems flag', { type: 'array', prefixItems: [scalar], items: object, additionalItems: false }],
  ] as const)('refuses %s', (_name, schema) => {
    expect(() => chatLeafTypes(section(schema), ['entries'])).toThrow();
  });

  it.each([
    ['homogeneous array', { type: 'array', items: scalar }],
    ['closed scalar tuple', tuple({ type: 'integer' })],
    ['scalar tail', { type: 'array', prefixItems: [scalar], items: { type: 'number' } }],
    ['sibling bound', { allOf: [{ type: 'array', prefixItems: [scalar, object] }, { maxItems: 1 }] }],
    ['sibling closed tail', { allOf: [{ type: 'array', prefixItems: [scalar, object] }, { items: false }] }],
    ['empty array', { type: 'array', items: false, maxItems: 0 }],
    ['large bound without a tuple', { type: 'array', items: scalar, maxItems: 1000000000 }],
  ] as const)('retains %s', (_name, schema) => {
    expect(chatLeafTypes(section(schema), ['entries'])).toEqual(['array']);
  });

  it('uses the existing reference and conjunction proof for each tuple position', () => {
    const schema = { ...section({ allOf: [{ $ref: '#/$defs/tuple' }, { maxItems: 2 }] }),
      $defs: { tuple: tuple({ anyOf: [{ type: 'integer' }, { type: 'boolean' }] }) } };
    expect(chatLeafTypes(schema, ['entries'])).toEqual(['array']);
    const unsafe = { ...section({ $ref: '#/$defs/tuple' }), $defs: { tuple: tuple({ anyOf: [scalar, object] }) } };
    expect(() => chatLeafTypes(unsafe, ['entries'])).toThrow();
  });
});

describe('tuple restrictions at the configuration Store boundary', () => {
  describe.each([
    ['object', object, { master: 'synthetic-private-value' }],
    ['nested array', nestedArray, ['synthetic-private-value']],
  ] as const)('externally invalid %s array beyond the schema length bound', (_name, item, invalidItem) => {
    it.each(['fields', 'get', 'set', 'unset'] as const)('refuses %s before prepare or apply', async operation => {
      const f = await fixture({ type: 'array', items: item, maxItems: 0 }, []);
      const current = JSON.parse(await readFile(f.file, 'utf8')); current.demo.entries = [invalidItem];
      await writeFile(f.file, JSON.stringify(current));
      expect((await f.store.validatePluginConfig('demo', current.demo)).valid).toBe(false);
      const before = await readFile(f.file, 'utf8');
      const revision = (await f.store.readSource()).revision;
      const prepare = vi.spyOn(f.document, 'prepare');
      if (operation === 'fields') expect((await f.store.readChat(['demo'], 'fields')).fields).toEqual([]);
      else if (operation === 'get') await expect(f.store.readChat(['demo', 'entries'], 'get')).rejects.toMatchObject({ kind: 'leaf' });
      else await expect(f.store.patchChat({ expectedRevision: revision, patches: operation === 'set'
        ? [{ op: 'set', path: ['demo', 'entries'], value: [] }] : [{ op: 'remove', path: ['demo', 'entries'] }] }))
        .rejects.toMatchObject({ kind: 'leaf' });
      expect(prepare).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
      expect(await readFile(f.file, 'utf8')).toBe(before);
    });
  });

  describe.each([
    ['object', object, { master: 'before' }, { master: 'after' }],
    ['nested array', nestedArray, ['before'], ['after']],
  ] as const)('schema-valid %s tuple', (_name, second, beforeValue, afterValue) => {
    it.each(['fields', 'get', 'set', 'unset'] as const)('refuses %s before prepare, commit or apply', async operation => {
      const f = await fixture(tuple(second), ['name', beforeValue]);
      const before = await readFile(f.file, 'utf8');
      const revision = (await f.store.readSource()).revision;
      const prepare = vi.spyOn(f.document, 'prepare');
      if (operation === 'fields') expect((await f.store.readChat(['demo'], 'fields')).fields).toEqual([]);
      else if (operation === 'get') await expect(f.store.readChat(['demo', 'entries'], 'get')).rejects.toMatchObject({ kind: 'leaf' });
      else await expect(f.store.patchChat({ expectedRevision: revision,
        patches: operation === 'set' ? [{ op: 'set', path: ['demo', 'entries'], value: ['name', afterValue] }]
          : [{ op: 'remove', path: ['demo', 'entries'] }] })).rejects.toMatchObject({ kind: 'leaf' });
      expect(prepare).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled();
      expect(await readFile(f.file, 'utf8')).toBe(before);
    });
  });

  it('keeps a schema-valid closed scalar tuple discoverable, readable and writable', async () => {
    const f = await fixture(tuple({ type: 'integer' }), ['name', 1]);
    expect((await f.store.readChat(['demo'], 'fields')).fields).toEqual([{ path: ['demo', 'entries'], type: ['array'] }]);
    expect(await f.store.readChat(['demo', 'entries'], 'get')).toMatchObject({ value: ['name', 1] });
    const revision = (await f.store.readSource()).revision;
    expect(await f.store.patchChat({ expectedRevision: revision,
      patches: [{ op: 'set', path: ['demo', 'entries'], value: ['updated', 2] }] })).toMatchObject({ status: 'saved' });
    expect((await f.document.read()).document.demo).toEqual({ entries: ['updated', 2] });
    expect(f.apply).toHaveBeenCalledOnce();
  });

  it('still lets safe scalar arrays with an invalid length be inspected and corrected', async () => {
    const f = await fixture({ type: 'array', items: scalar, maxItems: 1 }, ['before']);
    const current = JSON.parse(await readFile(f.file, 'utf8')); current.demo.entries = ['before', 'extra'];
    await writeFile(f.file, JSON.stringify(current));
    expect((await f.store.validatePluginConfig('demo', current.demo)).valid).toBe(false);
    expect(await f.store.readChat(['demo', 'entries'], 'get')).toMatchObject({ value: ['before', 'extra'] });
    const revision = (await f.store.readSource()).revision;
    expect(await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'entries'], value: ['fixed'] }] }))
      .toMatchObject({ status: 'saved' });
    expect(f.apply).toHaveBeenCalledOnce();
  });
});
