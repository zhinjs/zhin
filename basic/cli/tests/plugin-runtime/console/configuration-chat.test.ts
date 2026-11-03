import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigDocumentConflictError, createConfigDocument } from '@zhin.js/config-file';
import type { ConsoleConfigApplication } from '@zhin.js/console-protocol';
import { ConsoleConfigurationStore, ConfigChatRequestRejectedError } from '../../../src/plugin-runtime/console/configuration.js';
import { ConfigChatAccessError, assertChatConfigurationAccess } from '../../../src/plugin-runtime/console/configuration-chat-policy.js';
import { parseConfigurationPath } from '../../../src/plugin-runtime/console/configuration-path.js';
import { normalizeConfigPatchOperations } from '../../../src/plugin-runtime/console/configuration-patch.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const schema = { type: 'object', additionalProperties: false, $defs: { safe: { type: 'object', additionalProperties: false, properties: { size: { type: 'number' } } } },
  properties: { label: { type: 'string', default: 'private-default', examples: ['private-example'], enum: ['before', 'after', 'private-enum'] },
    count: { type: 'integer', minimum: 0 }, password: { type: 'string', writeOnly: true },
    nested: { type: 'object', properties: { credential: { type: 'string' }, color: { type: 'string' } } },
    safe: { $ref: '#/$defs/safe' }, unspecified: {},
    dictionary: { type: 'object', additionalProperties: { type: 'string' } } } };

async function fixture(initial: Record<string, unknown> = { label: 'before', password: 'private-literal', safe: { size: 1 }, dictionary: { 'literal.dot/key': 'public' } }, overrides: Partial<ConstructorParameters<typeof ConsoleConfigurationStore>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-chat-config-')); roots.push(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'chat-fixture', zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
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

describe('configuration paths', () => {
  it('accepts simple paths and lossless JSON Pointer escapes', () => {
    expect(parseConfigurationPath('')).toEqual([]);
    expect(parseConfigurationPath('demo.safe.size')).toEqual(['demo', 'safe', 'size']);
    expect(parseConfigurationPath('/demo/dictionary/literal.dot~1key')).toEqual(['demo', 'dictionary', 'literal.dot/key']);
    expect(parseConfigurationPath('/a~0b')).toEqual(['a~b']);
  });
  it.each(['.', 'demo..label', '/demo/~2', '/demo/', '/__proto__/x', 'demo.constructor', '/demo/\u0000'])('rejects unsafe/ambiguous %j', path => {
    expect(() => parseConfigurationPath(path)).toThrow('Invalid configuration path');
  });
  it.each(['__proto__', 'constructor', 'prototype'])('uses the same forbidden-segment policy for parser, patches and reads: %s', async key => {
    expect(() => parseConfigurationPath(`/demo/${key}`)).toThrow();
    expect(() => normalizeConfigPatchOperations([{ op: 'remove', path: ['demo', key] }])).toThrow();
    const f = await fixture();
    await expect(f.store.readChat(['demo', key], 'get')).rejects.toMatchObject({ kind: 'unknown' });
  });
});

describe('chat schema proof', () => {
  it.each([{ writeOnly: true }, { secret: true }, { format: 'password' }, { component: 'password' },
    { 'x-zhin-config': { secret: true } }, { 'x-zhin-config': { component: 'password' } }])('rejects secret metadata %j', metadata => {
    expect(() => assertChatConfigurationAccess({ type: 'string', ...metadata }, [], ['value'])).toThrow(ConfigChatAccessError);
  });
  it.each([{}, { type: 'string', not: { const: 'x' } }, { type: 'string', 'x-zhin-config': { hidden: true } },
    { $ref: '#/missing' }, { type: 'object', unevaluatedProperties: false }, { type: 'string', $dynamicAnchor: 'node' }])('rejects uncertain schemas %j', uncertain => {
    expect(() => assertChatConfigurationAccess(uncertain, [], ['value'])).toThrow(ConfigChatAccessError);
  });
  it('checks every union/intersection branch and pattern-based child', () => {
    expect(() => assertChatConfigurationAccess({ allOf: [{ type: 'object' }, { properties: { label: { type: 'string' } } }] }, ['label'], ['safe'])).not.toThrow();
    expect(() => assertChatConfigurationAccess({ anyOf: [{ type: 'string' }, { type: 'string', writeOnly: true }] }, [], ['private'])).toThrow(ConfigChatAccessError);
    expect(() => assertChatConfigurationAccess({ type: 'object', patternProperties: { '^entry': { type: 'string', secret: true } } }, ['entry1'], ['private'])).toThrow(ConfigChatAccessError);
  });
  it('does not confuse a declared token budget with an access token', () => {
    expect(() => assertChatConfigurationAccess({ type: 'object', properties: { maxTokens: { type: 'integer' } } }, ['maxTokens'], [100])).not.toThrow();
  });
  it.each(['${PRIVATE_TOKEN}', '${API_KEY:-fallback}', 'env://PASSWORD'])('never resolves or exposes a secret environment reference %s', value => {
    expect(() => assertChatConfigurationAccess({ type: 'string' }, [], [value])).toThrow(ConfigChatAccessError);
  });
  it.each([{ apiKey: 'private-literal' }, ['private-literal'], 1, null])('refuses a malformed stored value under a string schema: %j', value => {
    expect(() => assertChatConfigurationAccess({ type: 'string' }, [], [value])).toThrow(ConfigChatAccessError);
  });
});

describe('Console project/chat configuration entrypoints', () => {
  it('keeps ordinary patch scopes intact while trusted writes validate and apply one complete candidate', async () => {
    const validateConfiguration = vi.fn(async () => undefined);
    const applyConfiguration = vi.fn(async (revision?: string): Promise<ConsoleConfigApplication> => ({ operationId: 'config:1234:1', sourceRevision: revision!, saved: true,
      generation: 2, applicationRevision: 1, groups: [] }));
    const f = await fixture(undefined, { validateConfiguration, applyConfiguration });
    const { revision } = await f.store.readSource();
    const request = { expectedRevision: revision, patches: [{ op: 'set' as const, path: ['demo', 'label'], value: 'after' }] };
    await expect(f.store.patch(request)).rejects.toThrow();
    expect(await f.store.patchProject(request)).toMatchObject({ status: 'saved' });
    expect(validateConfiguration).toHaveBeenCalledTimes(1); expect(applyConfiguration).toHaveBeenCalledTimes(1);
    expect(await f.store.readChat(['demo', 'label'], 'get')).toMatchObject({ value: 'after' });
  });
  it('rejects an atomic declaration/configuration addition without saving any field', async () => {
    const f = await fixture();
    const { revision } = await f.store.readSource();
    const before = await readFile(f.file, 'utf8'); const prepare = vi.spyOn(f.document, 'prepare');
    expect(await f.store.patchProject({ expectedRevision: revision, patches: [
      { op: 'set', path: ['plugins', 'new'], value: './other' }, { op: 'set', path: ['new'], value: { label: 'after' } },
    ] })).toMatchObject({ status: 'invalid' });
    expect(await readFile(f.file, 'utf8')).toBe(before); expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    [['configVersion'], 2], [['plugins'], { demo: './other' }], [['disable_plugins'], ['demo']],
    [['plugin', 'label'], 'private-value'], [['undeclared', 'label'], 'private-value'],
  ])('chat preserves the canonical project write restriction for %j', async (path, value) => {
    const applyConfiguration = vi.fn(async (): Promise<ConsoleConfigApplication> => { throw new Error('must not apply'); });
    const f = await fixture(undefined, { applyConfiguration });
    const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    const result = await f.store.patchChat({ expectedRevision: revision, patches: [
      { op: 'set', path: ['demo', 'label'], value: 'after' }, { op: 'set', path, value },
    ] });
    expect(result).toMatchObject({ status: 'invalid', revision }); expect(JSON.stringify(result)).not.toContain('private-value');
    expect(await readFile(f.file, 'utf8')).toBe(before); expect(prepare).not.toHaveBeenCalled(); expect(applyConfiguration).not.toHaveBeenCalled();
  });
  it('continues to permit known safe Host business fields through the canonical project boundary', async () => {
    const f = await fixture(); const { revision } = await f.store.readSource();
    expect(await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['locale'], value: 'en' }] })).toMatchObject({ status: 'saved' });
    expect(JSON.parse(await readFile(f.file, 'utf8')).locale).toBe('en');
  });
  it('writes a literal dot key, array index and escaped slash/tilde through the real project CAS path', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'demo/schema.json'), JSON.stringify({ ...schema, properties: { ...schema.properties,
      'dot.key': { type: 'array', items: { type: 'object', properties: { 'a/b~c': { type: 'string' } } } },
    } }));
    const before = JSON.parse(await readFile(f.file, 'utf8'));
    before.demo['dot.key'] = [{ 'a/b~c': 'before' }];
    await writeFile(f.file, JSON.stringify(before));
    const { revision } = await f.store.readSource();
    const patches = [{ op: 'set' as const, path: parseConfigurationPath('/demo/dot.key/0/a~1b~0c'), value: 'after' }];
    await expect(f.store.patch({ expectedRevision: revision, patches })).rejects.toThrow();
    expect(await f.store.patchProject({ expectedRevision: revision, patches })).toMatchObject({ status: 'saved' });
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo['dot.key'][0]['a/b~c']).toBe('after');
    expect(await f.store.patchProject({ expectedRevision: revision, patches })).toMatchObject({ status: 'conflict' });
  });
  it('reads precise safe fields and exposes only safe schema structure and keys', async () => {
    const f = await fixture();
    expect(await f.store.readChat(['demo', 'safe'], 'get')).toMatchObject({ value: { size: 1 } });
    expect(await f.store.readChat(parseConfigurationPath('/demo/dictionary/literal.dot~1key'), 'get')).toMatchObject({ value: 'public' });
    const list = await f.store.readChat(['demo'], 'list');
    expect(list.keys).toContain('label'); expect(list.keys).not.toContain('password'); expect(list.keys).not.toContain('unspecified');
    const summary = JSON.stringify(await f.store.readChat(['demo'], 'schema'));
    expect(summary).not.toMatch(/private-|password|writeOnly|default|examples|enum/);
    expect((await f.store.readChat([], 'list')).keys).toContain('demo');
  });
  it.each([['demo', 'password'], ['demo'], ['demo', 'nested'], ['demo', 'unspecified'], ['demo', 'absent']])('rejects sensitive or unknown target %j without returning data', async (...path) => {
    const f = await fixture();
    await expect(f.store.readChat(path, 'get')).rejects.toBeInstanceOf(ConfigChatAccessError);
  });
  it('rejects ancestor replacement/removal even when secrets are omitted from the new value', async () => {
    const f = await fixture(); const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    for (const patch of [{ op: 'set' as const, path: ['demo'], value: { label: 'after' } }, { op: 'remove' as const, path: ['demo'] }]) {
      await expect(f.store.patchChat({ expectedRevision: revision, patches: [patch] })).rejects.toMatchObject({ kind: 'sensitive' });
    }
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it('refuses malformed current values rather than trusting the declared primitive type', async () => {
    const f = await fixture({ label: { apiKey: 'private-literal' } });
    await expect(f.store.readChat(['demo', 'label'], 'get')).rejects.toMatchObject({ kind: 'unknown' });
  });
  it('rejects rebinding even inside a combined business update and never exposes old secrets', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'other/schema.json'), JSON.stringify({ type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } }));
    const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    const result = await f.store.patchChat({ expectedRevision: revision, patches: [
      { op: 'set', path: ['plugins', 'demo'], value: './other' }, { op: 'set', path: ['demo'], value: { label: 'after' } },
    ] });
    expect(result).toMatchObject({ status: 'invalid' }); expect(JSON.stringify(result)).not.toContain('private-literal');
    expect(prepare).not.toHaveBeenCalled();
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it('does not launder an existing secret through a binding-only schema change', async () => {
    const f = await fixture({ label: 'synthetic-private-value' });
    await writeFile(join(f.root, 'demo/schema.json'), JSON.stringify({ type: 'object', additionalProperties: false, properties: { label: { type: 'string', writeOnly: true } } }));
    await writeFile(join(f.root, 'other/schema.json'), JSON.stringify({ type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } }));
    await expect(f.store.readChat(['demo', 'label'], 'get')).rejects.toMatchObject({ kind: 'sensitive' });
    const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    const result = await f.store.patchChat({ expectedRevision: revision,
      patches: [{ op: 'set', path: ['plugins', 'demo'], value: './other' }] });
    expect(result).toMatchObject({ status: 'invalid' }); expect(JSON.stringify(result)).not.toContain('synthetic-private-value');
    expect(prepare).not.toHaveBeenCalled();
    expect(await readFile(f.file, 'utf8')).toBe(before);
    await expect(f.store.readChat(['demo', 'label'], 'get')).rejects.toMatchObject({ kind: 'sensitive' });
  });
  it('preserves the declaration-write boundary even when both business schemas are safe', async () => {
    const f = await fixture({ label: 'before' });
    const safe = { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } };
    for (const name of ['demo', 'other']) await writeFile(join(f.root, name, 'schema.json'), JSON.stringify(safe));
    const { revision } = await f.store.readSource();
    const before = await readFile(f.file, 'utf8'); const prepare = vi.spyOn(f.document, 'prepare');
    expect(await f.store.patchChat({ expectedRevision: revision,
      patches: [{ op: 'set', path: ['plugins', 'demo'], value: './other' }] })).toMatchObject({ status: 'invalid' });
    expect(await readFile(f.file, 'utf8')).toBe(before); expect(prepare).not.toHaveBeenCalled();
    expect(await f.store.readChat(['demo', 'label'], 'get')).toMatchObject({ value: 'before' });
  });
  it('keeps safe declaration additions and removals with the source/plugin-management authority', async () => {
    const f = await fixture({ label: 'before' });
    const safe = { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } } };
    for (const name of ['demo', 'other']) await writeFile(join(f.root, name, 'schema.json'), JSON.stringify(safe));
    const { revision } = await f.store.readSource(); const before = await readFile(f.file, 'utf8'); const prepare = vi.spyOn(f.document, 'prepare');
    const added = await f.store.patchChat({ expectedRevision: revision, patches: [
      { op: 'set', path: ['plugins', 'new'], value: './other' }, { op: 'set', path: ['new'], value: { label: 'after' } },
    ] });
    expect(added).toMatchObject({ status: 'invalid' });
    expect(await f.store.patchChat({ expectedRevision: revision, patches: [
      { op: 'remove', path: ['plugins', 'demo'] }, { op: 'remove', path: ['demo'] },
    ] })).toMatchObject({ status: 'invalid' });
    const document = JSON.parse(await readFile(f.file, 'utf8'));
    expect(await readFile(f.file, 'utf8')).toBe(before); expect(prepare).not.toHaveBeenCalled();
    expect(document.plugins).toEqual({ demo: './demo' }); expect(document.demo.label).toBe('before'); expect(document.new).toBeUndefined();
  });
  it.each([false, true])('checks the affected tuple when removing a shifting array element (secret=%s)', async secret => {
    const f = await fixture({ tuple: ['safe-first', 'safe-second', 'synthetic-private-value'] });
    await writeFile(join(f.root, 'demo/schema.json'), JSON.stringify({ type: 'object', additionalProperties: false, properties: {
      tuple: secret ? { type: 'array', minItems: 3,
        prefixItems: [{ type: 'string' }, { type: 'string' }, { type: 'string', writeOnly: true }], items: false }
        : { type: 'array', items: { type: 'string' } },
    } }));
    const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const operation = f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'remove', path: ['demo', 'tuple', '1'] }] });
    if (secret) {
      await expect(operation).rejects.toMatchObject({ kind: 'sensitive' });
      expect(await readFile(f.file, 'utf8')).toBe(before);
    } else {
      expect(await operation).toMatchObject({ status: 'saved' });
      expect(await f.store.readChat(['demo', 'tuple', '1'], 'get')).toMatchObject({ value: 'synthetic-private-value' });
    }
  });
  it('serializes chat safety checks with the write and rejects the second stale mutation', async () => {
    const applyConfiguration = vi.fn(async (revision?: string): Promise<ConsoleConfigApplication> => ({ operationId: 'private-operation', sourceRevision: revision!, saved: true,
      generation: 2, applicationRevision: 1, groups: [{ id: 'private-group', paths: [['private-path']], effect: 'in-place', status: 'applied', reasonCode: 'private-reason', dependsOn: ['private-dependency'] }] }));
    const f = await fixture(undefined, { applyConfiguration }); const { revision } = await f.store.readSource();
    const request = { expectedRevision: revision, patches: [{ op: 'set' as const, path: ['demo', 'label'], value: 'after' }] };
    const outcomes = await Promise.all([f.store.patchChat(request), f.store.patchChat(request)]);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['saved', 'conflict']);
    expect(outcomes[1]).toMatchObject({ current: [] });
    expect(applyConfiguration).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outcomes[0])).not.toMatch(/private-(?:operation|group|path|reason|dependency)/);
  });
  it('returns conflict and invalid summaries without any stored or validation values', async () => {
    const f = await fixture(); const { revision } = await f.store.readSource();
    const conflict = await f.store.patchChat({ expectedRevision: 'stale', patches: [{ op: 'set', path: ['demo'], value: {} }] });
    expect(conflict).toMatchObject({ status: 'conflict', current: [] });
    expect(JSON.stringify(conflict)).not.toContain('private-literal');
    const invalid = await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'count'], value: -1 }] });
    expect(invalid).toMatchObject({ status: 'invalid', errors: [{ path: '$', message: '配置校验失败，未保存' }] });
    await expect(f.store.readChat(['demo', 'count'], 'get')).rejects.toMatchObject({ kind: 'missing' });
  });
  it('does not reinterpret an unknown commit as access denial or repeat/rollback a write', async () => {
    const f = await fixture(); const { revision } = await f.store.readSource();
    const prepare = f.document.prepare.bind(f.document); let commits = 0; let rollbacks = 0;
    vi.spyOn(f.document, 'prepare').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      return { ...prepared, commit: async () => { commits++; await prepared.commit(); throw new Error('private-parser-excerpt'); },
        rollback: async () => { rollbacks++; await prepared.rollback(); } };
    });
    let caught: unknown;
    try { await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'label'], value: 'after' }] }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error); expect(caught).not.toBeInstanceOf(ConfigChatAccessError);
    expect(String(caught)).not.toContain('private-parser-excerpt');
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('after');
    expect(commits).toBe(1); expect(rollbacks).toBe(0);
  });
  it.each(['prepare', 'candidate', 'validation'] as const)('classifies a chat %s failure before commit as rejected, not unconfirmed', async stage => {
    const f = await fixture(undefined, stage === 'validation' ? { validateConfiguration: async () => { throw new Error('private-validation-excerpt'); } } : {});
    const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    const prepare = vi.spyOn(f.document, 'prepare');
    if (stage === 'prepare') prepare.mockRejectedValueOnce(new Error('private-preparation-excerpt'));
    let caught: unknown;
    try { await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set',
      path: stage === 'candidate' ? ['demo', 'dictionary', 'literal.dot/key', 'field'] : ['demo', 'label'], value: 'after' }] }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ConfigChatRequestRejectedError);
    expect(String(caught)).toContain('未保存'); expect(String(caught)).not.toContain('private-');
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it.each(['contains', 'dependencies'] as const)('denies an unsupported %s subschema before reads and parent writes', async keyword => {
    const f = await fixture(keyword === 'contains' ? { samples: ['synthetic-private-value'] } : { label: 'synthetic-private-value' });
    const protectedSchema = keyword === 'contains'
      ? { type: 'object', additionalProperties: false, properties: { samples: { type: 'array', items: { type: 'string' }, contains: { writeOnly: true } } } }
      : { type: 'object', additionalProperties: false, properties: { label: { type: 'string' } },
        dependencies: { label: { type: 'object', properties: { label: { type: 'string', writeOnly: true } } } } };
    await writeFile(join(f.root, 'demo/schema.json'), JSON.stringify(protectedSchema));
    const value = keyword === 'contains' ? { samples: ['synthetic-private-value'] } : { label: 'synthetic-private-value' };
    expect((await f.store.validatePluginConfig('demo', value)).valid).toBe(true);
    const before = await readFile(f.file, 'utf8'); const { revision } = await f.store.readSource();
    await expect(f.store.readChat(['demo', keyword === 'contains' ? 'samples' : 'label'], 'get')).rejects.toMatchObject({ kind: 'unknown' });
    await expect(f.store.readChat(['demo'], 'get')).rejects.toMatchObject({ kind: 'unknown' });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo'], value }] })).rejects.toMatchObject({ kind: 'unknown' });
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it('rejects nested schema resource scopes rather than resolving their references against the wrong root', async () => {
    const f = await fixture({ nested: { label: 'synthetic-private-value' } });
    await writeFile(join(f.root, 'demo/schema.json'), JSON.stringify({ type: 'object', $defs: { field: { type: 'string', const: 'public' } }, properties: {
      nested: { $id: 'urn:fixture:private-resource', type: 'object',
        $defs: { field: { type: 'string', const: 'synthetic-private-value', writeOnly: true } }, properties: { label: { $ref: '#/$defs/field' } } },
    } }));
    expect((await f.store.validatePluginConfig('demo', { nested: { label: 'synthetic-private-value' } })).valid).toBe(true);
    await expect(f.store.readChat(['demo', 'nested', 'label'], 'get')).rejects.toMatchObject({ kind: 'unknown' });
  });
  it('keeps a root schema identity and root-local references usable', async () => {
    const f = await fixture({ label: 'public' });
    await writeFile(join(f.root, 'demo/schema.json'), JSON.stringify({ $id: 'urn:fixture:public-resource', type: 'object',
      $defs: { field: { type: 'string' } }, properties: { label: { $ref: '#/$defs/field' } } }));
    expect(await f.store.readChat(['demo', 'label'], 'get')).toMatchObject({ value: 'public' });
  });
  it('keeps a confirmed commit conflict rejected when reading its latest source also fails', async () => {
    const f = await fixture(); const { revision } = await f.store.readSource(); const before = await readFile(f.file, 'utf8');
    const prepare = f.document.prepare.bind(f.document);
    vi.spyOn(f.document, 'prepare').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      return { ...prepared, commit: async () => {
        vi.spyOn(f.document, 'read').mockRejectedValueOnce(new Error('private-read-failure'));
        throw new ConfigDocumentConflictError(f.file, revision, 'new-revision');
      } };
    });
    await expect(f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'label'], value: 'after' }] }))
      .rejects.toBeInstanceOf(ConfigChatRequestRejectedError);
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
  it('cannot turn an error after a confirmed commit into a pre-save rejection', async () => {
    const f = await fixture(undefined, { applyConfiguration: async () => { throw new Error('apply failed'); },
      readApplication: () => { throw new ConfigChatRequestRejectedError(); } });
    const revision = (await f.document.read()).revision;
    let caught: unknown;
    try { await f.store.patchChat({ expectedRevision: revision, patches: [{ op: 'set', path: ['demo', 'label'], value: 'after' }] }); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error); expect(caught).not.toBeInstanceOf(ConfigChatRequestRejectedError);
    expect(String(caught)).toContain('未确认');
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('after');
  });
  it('preserves project commit uncertainty and the attempted revision after the file was written', async () => {
    const applyConfiguration = vi.fn(async (): Promise<ConsoleConfigApplication> => { throw new Error('must not apply without commit acknowledgement'); });
    const f = await fixture(undefined, { applyConfiguration }); const { revision } = await f.store.readSource();
    const prepare = f.document.prepare.bind(f.document); let commits = 0; let rollbacks = 0;
    vi.spyOn(f.document, 'prepare').mockImplementation(async (...args) => {
      const prepared = await prepare(...args);
      return { ...prepared, commit: async () => { commits++; await prepared.commit(); throw new Error('private-io-excerpt'); },
        rollback: async () => { rollbacks++; await prepared.rollback(); } };
    });
    const result = await f.store.patchProject({ expectedRevision: revision,
      patches: [{ op: 'set', path: ['demo', 'label'], value: 'after' }] });
    expect(result).toMatchObject({ status: 'unconfirmed', expectedRevision: revision });
    expect(JSON.stringify(result)).not.toContain('private-io-excerpt');
    expect(JSON.parse(await readFile(f.file, 'utf8')).demo.label).toBe('after');
    expect(commits).toBe(1); expect(rollbacks).toBe(0); expect(applyConfiguration).not.toHaveBeenCalled();
  });
  it('does not classify a preparation failure before commit as an unconfirmed project save', async () => {
    const f = await fixture(); const { revision } = await f.store.readSource(); const before = await readFile(f.file, 'utf8');
    vi.spyOn(f.document, 'prepare').mockRejectedValueOnce(new Error('synthetic preparation failure'));
    await expect(f.store.patchProject({ expectedRevision: revision,
      patches: [{ op: 'set', path: ['demo', 'label'], value: 'after' }] })).rejects.toThrow('synthetic preparation failure');
    expect(await readFile(f.file, 'utf8')).toBe(before);
  });
});
