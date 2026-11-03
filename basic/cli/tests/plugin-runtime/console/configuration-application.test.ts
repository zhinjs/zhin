import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigDocument } from '@zhin.js/config-file';
import type { ConsoleConfigApplication } from '@zhin.js/console-protocol';
import { ConfigValidationError, ConfigurationSupersededError } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../../src/plugin-runtime/console/configuration.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(options: Partial<ConstructorParameters<typeof ConsoleConfigurationStore>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-application-')); roots.push(root);
  const file = join(root, 'zhin.config.json');
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'application-fixture',
    zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts' } }));
  await writeFile(file, JSON.stringify({ configVersion: 2, plugins: {}, locale: 'zh-CN' }));
  const document = createConfigDocument(file);
  const store = new ConsoleConfigurationStore({ projectRoot: root, document, ...options });
  return { file, document, store };
}

function application(sourceRevision: string): ConsoleConfigApplication {
  return { operationId: 'config-1', sourceRevision, saved: true, generation: 2, applicationRevision: 1,
    groups: [{ id: 'locale', paths: [['locale']], effect: 'reload-plugin', status: 'applied', dependsOn: [] },
      { id: 'http', paths: [['http', 'port']], effect: 'restart-process', status: 'restart-pending', dependsOn: [] }] };
}

function requiredRevision(value: string | undefined): string {
  if (!value) throw new Error('The runtime must receive the exact saved/read source revision');
  return value;
}

describe('saved configuration and effective application', () => {
  it('applies only after saving and exposes partial results on save and refresh', async () => {
    let latest: ConsoleConfigApplication | undefined;
    const { document, store } = await fixture({
      applyConfiguration: async expectedRevision => {
        const saved = await document.read();
        expect(saved.document.locale).toBe('en');
        expect(expectedRevision).toBe(saved.revision);
        latest = application(saved.revision);
        return latest;
      },
      readApplication: () => latest,
    });
    const result = await store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en', http: { port: 8191 } }),
      (await store.readSource()).revision);
    expect(result).toMatchObject({ restartRequired: true, application: { sourceRevision: result.revision, generation: 2 } });
    expect((await store.readSource()).application).toEqual(latest);
  });

  it('rejects invalid full candidates before writing or applying', async () => {
    let applications = 0;
    const { file, store } = await fixture({
      validateConfiguration: async () => { throw new Error('Invalid candidate reference'); },
      applyConfiguration: async () => { applications++; return application('unreachable'); },
    });
    const before = await readFile(file, 'utf8');
    await expect(store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en' }),
      (await store.readSource()).revision)).rejects.toThrow('Invalid candidate reference');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(applications).toBe(0);
  });

  it('keeps a confirmed save when application throws and returns no sensitive error text', async () => {
    const { file, store } = await fixture({ applyConfiguration: async () => { throw new Error('synthetic-private-credential'); } });
    const result = await store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en' }),
      (await store.readSource()).revision);
    expect(JSON.parse(await readFile(file, 'utf8')).locale).toBe('en');
    expect(result).toMatchObject({ applicationError: 'unconfirmed', restartRequired: false });
    expect((await store.readSource()).applicationError).toBe('unconfirmed');
    expect(JSON.stringify(result)).not.toContain('synthetic-private-credential');
  });

  it('does not run application for a stale source revision', async () => {
    let calls = 0;
    const { document, store } = await fixture({ applyConfiguration: async () => { calls++; return application('new'); } });
    const revision = (await store.readSource()).revision;
    await (await document.prepareReplacement(revision, JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en' }))).commit();
    await expect(store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, locale: 'zh-CN' }), revision)).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it('explicitly applies a read revision without rewriting the file', async () => {
    const { file, store } = await fixture({ applyConfiguration: async revision => application(requiredRevision(revision)) });
    const source = await store.readSource();
    const before = await readFile(file, 'utf8');
    expect(await store.apply(source.revision)).toMatchObject({ status: 'applied',
      application: { sourceRevision: source.revision, groups: expect.arrayContaining([expect.objectContaining({ status: 'restart-pending' })]) } });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('rejects a stale explicit application without calling the runtime', async () => {
    let calls = 0;
    const { file, store } = await fixture({ applyConfiguration: async revision => { calls++; return application(requiredRevision(revision)); } });
    const { revision } = await store.readSource();
    await writeFile(file, JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en' }));
    expect(await store.apply(revision)).toMatchObject({ status: 'conflict' });
    expect(calls).toBe(0);
  });

  it('distinguishes a known invalid candidate from an uncertain application', async () => {
    const invalid = await fixture({ applyConfiguration: async () => { throw new ConfigValidationError(['synthetic invalid reference']); } });
    expect(await invalid.store.apply((await invalid.store.readSource()).revision)).toMatchObject({ status: 'invalid' });
    const unknown = await fixture({ applyConfiguration: async () => { throw new Error('synthetic-private-detail'); } });
    const result = await unknown.store.apply((await unknown.store.readSource()).revision);
    expect(result.status).toBe('unconfirmed');
    expect(JSON.stringify(result)).not.toContain('synthetic-private-detail');
  });

  it('retains save success but reports a known superseded application without retry', async () => {
    let calls = 0;
    const { store } = await fixture({ applyConfiguration: async () => { calls++; throw new ConfigurationSupersededError(); } });
    expect(await store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en' }),
      (await store.readSource()).revision)).toMatchObject({ applicationError: 'superseded' });
    expect(calls).toBe(1);
  });

  it('clears old uncertainty only when a newer runtime application is observed', async () => {
    let current = application('first');
    const { store } = await fixture({ readApplication: () => current,
      applyConfiguration: async () => { throw new Error('unconfirmed'); } });
    await store.replaceSource(JSON.stringify({ configVersion: 2, plugins: {}, locale: 'en' }), (await store.readSource()).revision);
    expect((await store.readSource()).applicationError).toBe('unconfirmed');
    current = { ...application('second'), operationId: 'config-2' };
    expect((await store.readSource()).applicationError).toBeUndefined();
  });
});
