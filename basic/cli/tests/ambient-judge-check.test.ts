/** ADR 0066 P3: `zhin doctor` checks of the interjection judge. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAmbientJudgeMigration, checkRetiredAmbientTriggerKeys } from '../src/utils/ambient-judge-check.js';
import type { HostHttpConfig } from '../src/utils/host-http.js';

const YML = ['ai:', '  trigger:', '    # 开启插话的群', '    ambient:', '      conversations: ["qq:1"]', '      minConfidence: 0.8', '      mode: shadow', '      quietMs: 4000', ''].join('\n');
const migratedView = { migration: { status: 'migrated' as const, at: 1, triggerKeys: ['ai.trigger.ambient.minConfidence', 'ai.trigger.ambient.mode'],
  triggerValues: { minConfidence: 0.8, mode: 'shadow' }, triggerSeen: { minConfidence: 0.8, mode: 'shadow' } } };

async function withYml(run: (file: string) => Promise<void>, text = YML) {
  const dir = await mkdtemp(join(tmpdir(), 'ambient-doctor-'));
  try { const file = join(dir, 'zhin.config.yml'); await writeFile(file, text); await run(file); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

describe('retired ai.trigger.ambient keys (H1)', () => {
  it.each([
    ['the instance is not running', undefined, '无法连接运行中的实例'],
    ['nothing was migrated yet', {}, '实例还没有迁移它们'],
    ['the migration failed', { migration: { status: 'failed', at: 1, failure: { reason: 'conflict' } } }, '插话判断迁移失败'],
    ['the migration was reverted', { migration: { status: 'reverted', at: 1, triggerKeys: ['ai.trigger.ambient.mode'], triggerValues: { mode: 'shadow' } } }, '迁移已回退'],
  ] as const)('refuses --fix while %s: the keys still apply', async (_state, view, reason) => {
    await withYml(async file => {
      const result = await checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, ...(view ? { view: view as never } : {}) });
      expect(result).toMatchObject({ status: 'warn', message: expect.stringContaining(reason) });
      expect(result.message).toContain('仍然生效');
      expect(result.message).toContain('没有删除');
      expect(await readFile(file, 'utf8')).toBe(YML);
    });
  });

  it('once migrated: warns that they no longer apply, and --fix removes exactly them keeping every other key and comment', async () => {
    await withYml(async file => {
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', view: migratedView }))
        .resolves.toMatchObject({ status: 'warn', message: expect.stringContaining('不再单独生效'), fix: 'zhin doctor --fix 删除已迁移的项' });
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', expired: true, view: migratedView })).resolves.toMatchObject({ status: 'error' });
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, view: migratedView })).resolves.toMatchObject({ status: 'ok' });
      const text = await readFile(file, 'utf8');
      expect(text).not.toMatch(/minConfidence|mode:/u);
      expect(text).toContain('conversations');
      expect(text).toContain('quietMs: 4000');
      expect(text).toContain('# 开启插话的群');
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', view: migratedView })).resolves.toMatchObject({ status: 'ok' });
    });
  });

  it('compares normalized values: minConfidence 1.2 read as 1 is settled and removed (N3)', async () => {
    const view = { migration: { status: 'migrated' as const, at: 1, triggerKeys: ['ai.trigger.ambient.minConfidence'], triggerValues: { minConfidence: 1 }, triggerSeen: { minConfidence: 1 } } };
    await withYml(async file => {
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, view })).resolves.toMatchObject({ status: 'ok' });
      expect(await readFile(file, 'utf8')).not.toContain('minConfidence');
    }, 'ai:\n  trigger:\n    ambient:\n      minConfidence: 1.2\n');
  });

  it('treats a key added after the migration and already converted as settled (its value is in triggerSeen), not by triggerKeys (N3)', async () => {
    const view = { migration: { status: 'migrated' as const, at: 1, triggerKeys: [], triggerSeen: { mode: 'shadow' } } };
    await withYml(async file => {
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, view })).resolves.toMatchObject({ status: 'ok' });
      expect(await readFile(file, 'utf8')).not.toContain('mode');
    }, 'ai:\n  trigger:\n    ambient:\n      mode: shadow\n');
  });

  it('case C: the original shadow written back after the old Console switched to active is a pending write, not settled (R1)', async () => {
    const view = { policy: { mode: 'active' }, migration: { status: 'migrated' as const, at: 1, triggerKeys: ['ai.trigger.ambient.mode'],
      triggerValues: { mode: 'shadow' }, triggerSeen: { mode: 'active' }, after: { profile: 'small', mode: 'shadow' } } };
    await withYml(async file => {
      const result = await checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, view });
      expect(result).toMatchObject({ status: 'warn', message: expect.stringContaining('迁移之后写入') });
      expect(await readFile(file, 'utf8')).toContain('mode: shadow');
    }, 'ai:\n  trigger:\n    ambient:\n      mode: shadow\n');
    // While the stored judge still holds the migration's value, the original value is settled.
    const unchanged = { ...view, policy: { mode: 'shadow' } };
    await withYml(async file => {
      await expect(checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, view: { ...unchanged, migration: { ...unchanged.migration, triggerSeen: {} } } }))
        .resolves.toMatchObject({ status: 'ok' });
    }, 'ai:\n  trigger:\n    ambient:\n      mode: shadow\n');
  });

  it('keeps a key written after the migration (the next load converts it) and removes only the settled one', async () => {
    const view = { migration: { ...migratedView.migration, triggerKeys: ['ai.trigger.ambient.minConfidence'], triggerValues: { minConfidence: 0.8 }, triggerSeen: { minConfidence: 0.8 } } };
    await withYml(async file => {
      const result = await checkRetiredAmbientTriggerKeys({ configPath: file, label: 'zhin.config.yml', fix: true, view });
      expect(result).toMatchObject({ status: 'warn', message: expect.stringContaining('ai.trigger.ambient.mode 是迁移之后写入的') });
      const text = await readFile(file, 'utf8');
      expect(text).toContain('mode: shadow');
      expect(text).not.toContain('minConfidence');
    });
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
  const migrated = { policy: { profile: 'jev', minConfidence: 0.8 }, migration: { status: 'migrated' as const, at: Date.UTC(2026, 10, 17),
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
