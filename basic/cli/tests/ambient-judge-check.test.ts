/** ADR 0066 P3: `zhin doctor` checks of the interjection judge. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAmbientJudgeMigration, checkRetiredAmbientTriggerKeys } from '../src/utils/ambient-judge-check.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

describe('retired ai.trigger.ambient keys', () => {
  it('warns, and --fix removes exactly minConfidence and mode keeping every other key and comment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ambient-doctor-'));
    try {
      const file = join(dir, 'zhin.config.yml');
      await writeFile(file, [
        'ai:',
        '  trigger:',
        '    # 开启插话的群',
        '    ambient:',
        '      conversations: ["qq:1"]',
        '      minConfidence: 0.8',
        '      mode: shadow',
        '      quietMs: 4000',
        '',
      ].join('\n'));
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml' }))
        .resolves.toMatchObject({ status: 'warn', fix: 'zhin doctor --fix 删除这两项' });
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', expired: true })).resolves.toMatchObject({ status: 'error' });
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true })).resolves.toMatchObject({ status: 'ok' });
      const text = await readFile(file, 'utf8');
      expect(text).not.toMatch(/minConfidence|mode:/u);
      expect(text).toContain('conversations');
      expect(text).toContain('quietMs: 4000');
      expect(text).toContain('# 开启插话的群');
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml' })).resolves.toMatchObject({ status: 'ok' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

function instance(view: Record<string, unknown>) {
  const state = structuredClone(view) as { migration?: Record<string, unknown> };
  const requests: string[] = [];
  const client: HostHttpConfig = {
    baseUrl: 'http://gateway.local/api/agent/inference', token: '',
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push(`${init?.method ?? 'GET'} ${path}`);
      if (path.endsWith('/migration/noticed') && state.migration) state.migration.noticedAt = 1;
      return new Response(JSON.stringify({ success: true, data: path.endsWith('/noticed') ? {} : state }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return { client, requests };
}

describe('the migration result of the running instance', () => {
  const migrated = { policy: { profile: 'jev', minConfidence: 0.8 }, migration: { status: 'migrated', at: Date.UTC(2026, 10, 17),
    rows: [{ field: 'profile', value: 'jev', from: 'purposes.decisions.ambient.profile' }, { field: 'fallbacks', value: ['small'], from: 'purposes.ambient (language)' }],
    notes: [{ code: 'language-judge-became-fallback', value: 'small' }], triggerKeys: ['ai.trigger.ambient.minConfidence'] } };

  it('shows the result once, then only with --verbose', async () => {
    const { client, requests } = instance(migrated);
    const first = await checkAmbientJudgeMigration({ client });
    expect(first).toEqual([expect.objectContaining({ status: 'info', fix: '降级到旧版本前先运行 zhin ai purposes revert ambient-judge' })]);
    expect(first[0]!.message).toContain('profile = jev（来自 purposes.decisions.ambient.profile）');
    expect(first[0]!.message).toContain('small 成为第一个备用');
    expect(requests).toContain('POST /api/agent/inference/ambient-judge/migration/noticed');
    await expect(checkAmbientJudgeMigration({ client })).resolves.toEqual([]);
    await expect(checkAmbientJudgeMigration({ client, verbose: true })).resolves.toEqual([expect.objectContaining({ status: 'info' })]);
  });

  it('reports a failed migration as an error with its path', async () => {
    const { client } = instance({ migration: { status: 'failed', at: 1, failure: { reason: 'not-visible', path: 'purposes.ambient.profile' } } });
    await expect(checkAmbientJudgeMigration({ client })).resolves.toEqual([expect.objectContaining({ status: 'error',
      message: expect.stringContaining('purposes.ambient.profile'), fix: expect.stringContaining('purposes.ambient.profile') })]);
  });

  it('hints that a threshold below 0.5 does nothing for a decision model, and is silent without an instance', async () => {
    const { client } = instance({ policy: { minConfidence: 0.3 } });
    await expect(checkAmbientJudgeMigration({ client })).resolves.toEqual([expect.objectContaining({ name: '插话判断门槛', status: 'info' })]);
    await expect(checkAmbientJudgeMigration({ client: undefined })).resolves.toEqual([]);
  });
});
