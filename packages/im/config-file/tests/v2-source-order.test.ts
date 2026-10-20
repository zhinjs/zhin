import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigDocument } from '../src/index.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(extension: string, source: string) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-v2-source-'));
  directories.push(root);
  const file = join(root, `config.${extension}`);
  await writeFile(file, source);
  return { file, document: createConfigDocument(file) };
}

for (const extension of ['json', 'yml']) {
  it(`${extension}: keeps declaration source order through Host, config and whole-map patches`, async () => {
    const source = extension === 'json'
      ? '{"configVersion":2,"plugins":{"10":"ten","2":"two"},"10":{"token":"${API_KEY}"},"2":{},"http":{"port":8080}}\n'
      : 'configVersion: 2\nplugins:\n  "10": ten\n  "2": two\n"10":\n  token: "${API_KEY}" # keep\n"2": {}\nhttp:\n  port: 8080\n';
    const { file, document } = await fixture(extension, source);
    const initial = await document.read();
    expect(initial.pluginOrder).toEqual(['10', '2']);
    let prepared = await document.prepare(initial, [
      { op: 'set', path: ['http', 'port'], value: 9090 },
      { op: 'set', path: ['2', 'ready'], value: true },
      { op: 'set', path: ['plugins'], value: { '2': 'two', '10': 'ten', added: 'new' } },
    ]);
    expect(prepared.pluginOrder).toEqual(['10', '2', 'added']);
    expect((await prepared.commit()).pluginOrder).toEqual(['10', '2', 'added']);
    expect((await document.read()).pluginOrder).toEqual(['10', '2', 'added']);
    let text = await readFile(file, 'utf8');
    expect(text).toContain('${API_KEY}');
    if (extension === 'yml') expect(text).toContain('# keep');
    const snapshot = await document.read();
    prepared = await document.prepare(snapshot, [{ op: 'set', path: [], value: snapshot.document }]);
    await prepared.commit();
    expect((await document.read()).pluginOrder).toEqual(['10', '2', 'added']);
    text = await readFile(file, 'utf8');
    if (extension === 'json') expect(JSON.parse(text)['2'].ready).toBe(true);
  });
}

it('rejects duplicate JSON keys only for v2, including nested business fields', async () => {
  const { document: v1 } = await fixture('json', '{"plugins":{},"value":1,"value":2}');
  expect((await v1.read()).document.value).toBe(2);
  for (const text of [
    '{"configVersion":2,"plugins":{"a":"one","a":"two"}}',
    '{"configVersion":2,"plugins":{"a":"one"},"a":{"x":1,"x":2}}',
  ]) {
    const { document } = await fixture('json', text);
    await expect(document.read()).rejects.toThrow('Map keys must be unique');
  }
});

it('whole-source replacement reads its new order rather than the old snapshot order', async () => {
  const { document } = await fixture('json', '{"configVersion":2,"plugins":{"10":"ten","2":"two"}}');
  const transaction = await document.prepareReplacement((await document.read()).revision,
    '{"configVersion":2,"plugins":{"2":"two","10":"ten"}}');
  expect(transaction.pluginOrder).toEqual(['2', '10']);
  expect((await transaction.commit()).pluginOrder).toEqual(['2', '10']);
});

it('preserves CRLF and rejects malformed JSON despite YAML syntax being broader', async () => {
  const { file, document } = await fixture('json', '{\r\n  "configVersion": 2,\r\n  "plugins": {"10":"ten","2":"two"}\r\n}\r\n');
  await (await document.prepare(await document.read(), [{ op: 'set', path: ['disable_plugins'], value: ['10'] }])).commit();
  expect((await readFile(file, 'utf8')).replaceAll('\r\n', '')).not.toContain('\n');
  const { document: bad } = await fixture('json', '{"configVersion":2,"plugins":{},}');
  await expect(bad.read()).rejects.toThrow('Cannot parse JSON');
});

it.each(['json', 'yml'])('%s: edits nested array entries and rejects invalid sequence paths', async extension => {
  const source = extension === 'json'
    ? '{"configVersion":2,"plugins":{"10":"ten","2":"two"},"10":{"endpoints":[{"id":"a"},{"id":"b"}]}}'
    : 'configVersion: 2\nplugins:\n  "10": ten\n  "2": two\n"10":\n  endpoints:\n    - id: a\n    - id: b\n';
  const { document } = await fixture(extension, source);
  await (await document.prepare(await document.read(), [
    { op: 'set', path: ['10', 'endpoints', '0', 'id'], value: 'changed' },
    { op: 'remove', path: ['10', 'endpoints', '1'] },
  ])).commit();
  expect((await document.read()).document['10']).toEqual({ endpoints: [{ id: 'changed' }] });
  for (const index of ['no', '3']) await expect(document.prepare(await document.read(), [
    { op: 'set', path: ['10', 'endpoints', index, 'id'], value: 'bad' },
  ])).rejects.toThrow(/array index|out of bounds/);
});

it.each(['json', 'yml'])('%s: materializes a v2 document with ordered numeric aliases from sequential patches', async extension => {
  const { document } = await fixture(extension, '{}\n');
  await (await document.prepare(await document.read(), [
    { op: 'set', path: ['configVersion'], value: 2 },
    { op: 'set', path: ['plugins', '10'], value: 'ten' },
    { op: 'set', path: ['plugins', '2'], value: 'two' },
  ])).commit();
  expect((await document.read()).pluginOrder).toEqual(['10', '2']);
});

it('rejects YAML numeric/string keys which collapse to the same JS property', async () => {
  const { document } = await fixture('yml', 'configVersion: 2\nplugins:\n  10: ten\n  "10": other\n');
  await expect(document.read()).rejects.toThrow('Duplicate object key');
});

it('patches unquoted YAML numeric alias declarations and business blocks without duplicate keys', async () => {
  const { document, file } = await fixture('yml', 'configVersion: 2\nplugins:\n  10: ten\n  2: two\n10:\n  value: before\n2: {}\n');
  await (await document.prepare(await document.read(), [
    { op: 'set', path: ['plugins', '10'], value: 'changed-package' },
    { op: 'set', path: ['10', 'value'], value: 'after' },
  ])).commit();
  const snapshot = await document.read();
  expect(snapshot.pluginOrder).toEqual(['10', '2']);
  expect(snapshot.document.plugins).toEqual({ '10': 'changed-package', '2': 'two' });
  expect(snapshot.document['10']).toEqual({ value: 'after' });
  expect(await readFile(file, 'utf8')).toContain('  10: changed-package');
});

it('keeps unquoted numeric YAML keys in source order during whole-map and document patches', async () => {
  const { document } = await fixture('yml', 'configVersion: 2\nplugins:\n  10: ten\n  2: two\n10:\n  value: before\n2: {}\n');
  await (await document.prepare(await document.read(), [
    { op: 'set', path: ['plugins'], value: { '2': 'new-two', '10': 'new-ten' } },
  ])).commit();
  expect((await document.read()).pluginOrder).toEqual(['10', '2']);
  const current = await document.read();
  await (await document.prepare(current, [{ op: 'set', path: [], value: current.document }])).commit();
  expect((await document.read()).pluginOrder).toEqual(['10', '2']);
});

it('removes unquoted YAML numeric aliases and their business blocks by string config paths', async () => {
  const { document } = await fixture('yml', 'configVersion: 2\nplugins:\n  10: ten\n  2: two\n10:\n  value: keep\n2: {}\n');
  await (await document.prepare(await document.read(), [
    { op: 'remove', path: ['plugins', '10'] },
    { op: 'remove', path: ['10'] },
  ])).commit();
  const snapshot = await document.read();
  expect(snapshot.pluginOrder).toEqual(['2']);
  expect(snapshot.document.plugins).toEqual({ '2': 'two' });
  expect(Object.hasOwn(snapshot.document, '10')).toBe(false);
});
