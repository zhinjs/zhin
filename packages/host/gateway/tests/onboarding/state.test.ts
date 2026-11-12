import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsolePrincipal } from '@zhin.js/host-http';
import {
  detectConfiguredSteps, OnboardingError, OnboardingService, OnboardingStateStore, emptyOnboardingState,
} from '../../src/onboarding/index.js';
import { testUser } from '../utils/console-users.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'zhin-onboarding-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function rejects(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => undefined, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(OnboardingError);
  expect((error as OnboardingError).code).toBe(code);
}

describe('OnboardingStateStore', () => {
  it('writes atomically with mode 0600 and leaves no temp files', async () => {
    const store = new OnboardingStateStore(root);
    expect(await store.read()).toBeUndefined();
    const state = { ...emptyOnboardingState(), steps: { database: 'done', owner: 'pending', ai: 'skipped', adapters: 'pending' } } as const;
    await Promise.all(Array.from({ length: 8 }, () => store.write(state)));
    expect(await store.read()).toEqual(state);
    expect(JSON.parse(await readFile(join(root, '.zhin/onboarding.json'), 'utf8'))).toEqual(state);
    expect(await readdir(join(root, '.zhin'))).toEqual(['onboarding.json']);
    if (process.platform !== 'win32') expect((await stat(join(root, '.zhin/onboarding.json'))).mode & 0o777).toBe(0o600);
  });

  it('treats malformed files as absent and normalizes unknown step values', async () => {
    await mkdir(join(root, '.zhin'));
    const store = new OnboardingStateStore(root);
    await writeFile(store.file, '{not json');
    expect(await store.read()).toBeUndefined();
    await writeFile(store.file, JSON.stringify({ version: 2, steps: {} }));
    expect(await store.read()).toBeUndefined();
    await writeFile(store.file, JSON.stringify({ version: 1, steps: { database: 'done', ai: 'hacked' }, completedAt: 'nope', extra: 1 }));
    expect(await store.read()).toEqual({ version: 1, steps: { database: 'done', owner: 'pending', ai: 'pending', adapters: 'pending' } });
    await expect(store.write({ version: 3 } as never)).rejects.toThrow('Invalid onboarding state');
  });
});

describe('auto-detection for existing projects', () => {
  it('detects database, adapters and AI from the config', () => {
    expect([...detectConfiguredSteps({})]).toEqual([]);
    expect([...detectConfiguredSteps({
      database: { dialect: 'sqlite' }, plugins: { sandbox: '@zhin.js/adapter-sandbox', rss: '@zhin.js/plugin-rss' }, ai: { enabled: true },
    })].sort()).toEqual(['adapters', 'ai', 'database']);
    expect([...detectConfiguredSteps({ ai: { enabled: false }, plugins: { rss: '@zhin.js/plugin-rss' }, database: 'sqlite' })]).toEqual([]);
  });

  it('marks configured steps done on first read; owner follows IAM; skipped is never overridden', async () => {
    let owner = false;
    let config: Record<string, unknown> = { database: { dialect: 'mysql' }, plugins: { qq: '@zhin.js/adapter-qq' } };
    const service = new OnboardingService({ projectRoot: root, hasOwner: () => owner, readConfig: () => config });
    expect(await service.status()).toEqual({
      version: 1, steps: { database: 'done', owner: 'pending', ai: 'pending', adapters: 'done' }, required: true,
    });
    expect(await new OnboardingStateStore(root).read()).toMatchObject({ steps: { database: 'done', adapters: 'done' } });
    await service.markStep('ai', 'skipped');
    owner = true;
    config = { ...config, ai: { enabled: true } };
    expect((await service.status()).steps).toEqual({ database: 'done', owner: 'done', ai: 'skipped', adapters: 'done' });
  });

  it('reads the project YAML config by default', async () => {
    await writeFile(join(root, 'zhin.config.yml'), 'configVersion: 2\ndatabase:\n  dialect: sqlite\nplugins: {}\n');
    const service = new OnboardingService({ projectRoot: root, hasOwner: async () => true });
    expect((await service.status()).steps).toMatchObject({ database: 'done', owner: 'done', ai: 'pending' });
  });
});

describe('OnboardingService steps', () => {
  const bootstrap: ConsolePrincipal = { kind: 'bootstrap', open: false };

  it('marks steps, refuses the owner step and bad input, and completes once an owner exists', async () => {
    let owner = false;
    const service = new OnboardingService({ projectRoot: root, hasOwner: () => owner, readConfig: () => ({}), now: () => new Date('2026-11-11T00:00:00Z') });
    await rejects(service.markStep('owner', 'done'), 'invalid_input');
    await rejects(service.markStep('nope', 'done'), 'invalid_input');
    await rejects(service.markStep('ai', 'pending'), 'invalid_input');
    await rejects(service.complete(), 'conflict');
    expect((await service.markStep('database', 'skipped')).steps.database).toBe('skipped');
    expect((await service.markStep('adapters', 'done')).steps.adapters).toBe('done');
    owner = true;
    const done = await service.complete();
    expect(done).toMatchObject({ completedAt: '2026-11-11T00:00:00.000Z', required: false, steps: { owner: 'done', ai: 'pending' } });
    expect((await service.complete()).completedAt).toBe('2026-11-11T00:00:00.000Z');
    expect(await new OnboardingStateStore(root).read()).toMatchObject({ completedAt: '2026-11-11T00:00:00.000Z' });
  });

  it('enforces step credentials when a principal is given', async () => {
    let owner = false;
    const service = new OnboardingService({ projectRoot: root, hasOwner: () => owner, readConfig: () => ({}) });
    expect((await service.markStep('database', 'done', { principal: bootstrap })).steps.database).toBe('done');
    await rejects(service.markStep('ai', 'done', { principal: bootstrap }), 'forbidden');
    await rejects(service.markStep('adapters', 'skipped', { principal: testUser('viewer') }), 'forbidden');
    owner = true;
    await rejects(service.markStep('database', 'done', { principal: bootstrap }), 'forbidden');
    await rejects(service.complete({ principal: bootstrap }), 'forbidden');
    await rejects(service.complete({ principal: testUser('viewer') }), 'forbidden');
    expect((await service.markStep('ai', 'done', { principal: testUser('owner') })).steps.ai).toBe('done');
    expect((await service.complete({ principal: testUser('owner') })).required).toBe(false);
  });
});
