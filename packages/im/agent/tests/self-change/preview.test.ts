import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeChangeConfigPatch, type SelfChangeFileEntry } from '../../src/self-change/policy.js';
import {
  MAX_CHANGE_PREVIEW_BYTES,
  buildSelfChangePreview,
  configPatchImpact,
  describeSelfChangeImpact,
  lineDelta,
  type SelfChangeFilePlan,
  type SelfChangeImpactPort,
} from '../../src/self-change/preview.js';

let project: string;
beforeEach(() => { project = mkdtempSync(join(tmpdir(), 'zhin-change-preview-')); });
afterEach(() => rmSync(project, { recursive: true, force: true }));

function entry(path: string, content: string | null): SelfChangeFileEntry {
  return content === null
    ? { path, op: 'delete', sha256: null, bytes: 0 }
    : { path, op: 'write', sha256: 'x', bytes: Buffer.byteLength(content) };
}

function port(plan: SelfChangeFilePlan, hostConfigKeys: readonly string[] = ['http', 'ai', 'database']): SelfChangeImpactPort & { calls: string[][] } {
  const calls: string[][] = [];
  return { calls, hostConfigKeys, planFiles: (paths) => { calls.push([...paths]); return plan; } };
}

describe('lineDelta', () => {
  it('counts added and removed lines, ignoring moves', () => {
    expect(lineDelta('a\nb\nc\n', 'a\nc\nd\ne\n')).toEqual({ added: 2, removed: 1 });
    expect(lineDelta('a\nb\n', 'b\na\n')).toEqual({ added: 0, removed: 0 });
    expect(lineDelta('', 'x')).toEqual({ added: 1, removed: 0 });
    expect(lineDelta('x\nx\n', 'x\n')).toEqual({ added: 0, removed: 1 });
  });
});

describe('configPatchImpact', () => {
  const patch = (...paths: string[][]) => normalizeChangeConfigPatch({ expectedRevision: 'r1', patches: paths.map(path => ({ op: 'set', path, value: 1 })) });

  it('marks host sections as a restart, like Console config:patch', () => {
    const impact = configPatchImpact(patch(['http', 'port'], ['weather', 'unit']), ['http', 'ai']);
    expect(impact).toMatchObject({ kind: 'process', sections: ['http', 'weather'], hostSections: ['http'], estimated: false });
  });

  it('hot-reloads plugin-only sections', () => {
    expect(configPatchImpact(patch(['weather', 'unit']), ['http'])).toMatchObject({ kind: 'generation', hostSections: [], estimated: false });
  });

  it('assumes a restart when the host key list is unknown', () => {
    expect(configPatchImpact(patch(['weather', 'unit']))).toMatchObject({ kind: 'process', estimated: true });
  });
});

describe('buildSelfChangePreview', () => {
  it('summarises create / modify / delete against the production tree', async () => {
    mkdirSync(join(project, 'commands'), { recursive: true });
    writeFileSync(join(project, 'commands', 'old.ts'), 'one\ntwo\n');
    writeFileSync(join(project, 'commands', 'gone.ts'), 'a\nb\nc\n');
    const staged: Record<string, string> = { 'commands/new.ts': 'x\ny\n', 'commands/old.ts': 'one\nthree\n' };
    const impact = port({ kind: 'generation', reasons: ['capability changed'], subtrees: ['root/weather'], slots: ['cmd:ping'], fallbacks: [{ source: 'x', owners: ['root/extra'] }] });
    const preview = await buildSelfChangePreview({
      projectRoot: project,
      contentHash: 'h1',
      files: [entry('commands/new.ts', staged['commands/new.ts']!), entry('commands/old.ts', staged['commands/old.ts']!), entry('commands/gone.ts', null)],
      configPatch: null,
      readStaged: async target => staged[target] ?? null,
      impact,
      summary: '  加一个 ping 指令  ',
    });
    expect(preview.summary).toBe('加一个 ping 指令');
    expect(preview.contentHash).toBe('h1');
    expect(preview.files).toEqual([
      expect.objectContaining({ path: 'commands/new.ts', kind: 'create', added: 2, removed: 0, bytesBefore: null }),
      expect.objectContaining({ path: 'commands/old.ts', kind: 'modify', added: 1, removed: 1, bytesBefore: 8 }),
      expect.objectContaining({ path: 'commands/gone.ts', kind: 'delete', added: 0, removed: 3 }),
    ]);
    expect(impact.calls[0]).toEqual([join(project, 'commands', 'new.ts'), join(project, 'commands', 'old.ts'), join(project, 'commands', 'gone.ts')]);
    expect(preview.impact).toMatchObject({ kind: 'generation', subtrees: ['root/weather', 'root/extra'], slots: ['cmd:ping'], estimated: false, config: null });
    expect(describeSelfChangeImpact(preview.impact)).toContain('hot reload — 2 plugin(s)');
  });

  it('lets a host config section escalate a hot-reload file change to a restart', async () => {
    const preview = await buildSelfChangePreview({
      projectRoot: project,
      contentHash: 'h',
      files: [entry('commands/ping.ts', 'x')],
      configPatch: normalizeChangeConfigPatch({ expectedRevision: 'r', patches: [{ op: 'set', path: ['http', 'port'], value: 8080 }] }),
      readStaged: async () => 'x',
      impact: port({ kind: 'generation', reasons: ['r'], subtrees: ['root'], slots: [] }),
    });
    expect(preview.impact).toMatchObject({ kind: 'process', subtrees: [], slots: [] });
    expect(preview.impact.reasons).toContain('host config changed: http');
    expect(describeSelfChangeImpact(preview.impact)).toMatch(/^process restart required/u);
  });

  it('adds plugin config sections to the hot-reload subtrees', async () => {
    const preview = await buildSelfChangePreview({
      projectRoot: project,
      contentHash: 'h',
      files: [],
      configPatch: normalizeChangeConfigPatch({ expectedRevision: 'r', patches: [{ op: 'remove', path: ['weather', 'unit'] }] }),
      readStaged: async () => null,
      impact: port({ kind: 'none', reasons: [] }),
    });
    expect(preview.impact).toMatchObject({ kind: 'generation', subtrees: ['weather'], estimated: false });
  });

  it('passes a process plan from the planner through', async () => {
    const preview = await buildSelfChangePreview({
      projectRoot: project,
      contentHash: 'h',
      files: [entry('commands/ping.ts', 'x')],
      configPatch: null,
      readStaged: async () => 'x',
      impact: port({ kind: 'process', reasons: ['Root plugin source changed'] }),
    });
    expect(preview.impact).toMatchObject({ kind: 'process', reasons: ['Root plugin source changed'] });
  });

  it('estimates without a planner and says so', async () => {
    const preview = await buildSelfChangePreview({
      projectRoot: project,
      contentHash: 'h',
      files: [entry('commands/ping.ts', 'x')],
      configPatch: null,
      readStaged: async () => 'x',
    });
    expect(preview.impact).toMatchObject({ kind: 'generation', estimated: true });
    expect(describeSelfChangeImpact(preview.impact)).toContain('(estimated)');
  });

  it('refuses an oversized preview', async () => {
    const huge = 'r'.repeat(190);
    const reasons = Array.from({ length: 50 }, (_, index) => `${index}${huge}`);
    const subtrees = Array.from({ length: 50 }, (_, index) => `root/${'p'.repeat(1300)}${index}`);
    await expect(buildSelfChangePreview({
      projectRoot: project,
      contentHash: 'h',
      files: [entry('commands/ping.ts', 'x')],
      configPatch: null,
      readStaged: async () => 'x',
      impact: port({ kind: 'generation', reasons, subtrees, slots: [] }),
    })).rejects.toThrow(String(MAX_CHANGE_PREVIEW_BYTES));
  });
});
