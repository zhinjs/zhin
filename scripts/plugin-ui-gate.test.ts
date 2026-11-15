import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateAuditUiGate,
  evaluateStaticUiGate,
  formatUiGateSummary,
  listOfficialPluginsWithPages,
  readUiGate,
  validateUiGate,
} from './lib/plugin-ui-gate.mjs';
import { buildAuditRequest, runPluginUiAudit } from './check-plugin-ui-audit.mjs';
import { checkPluginPageUi, formatPageUiFinding } from '../basic/cli/src/plugin-check/page-checks.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function repoWith(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-ui-gate-test-'));
  temporaryDirectories.push(directory);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), content);
  }
  return directory;
}

const pkg = (name: string) => JSON.stringify({ name });
const gateFile = (gate: unknown) => JSON.stringify(gate);

function fixtureRepo(gate: unknown) {
  return repoWith({
    'scripts/plugin-ui-gate.json': gateFile(gate),
    'plugins/utils/clean/package.json': pkg('@zhin.js/clean'),
    'plugins/utils/clean/pages/index/index.tsx': 'export default () => <div className="p-4" />;\n',
    'plugins/utils/dirty/package.json': pkg('@zhin.js/dirty'),
    'plugins/utils/dirty/pages/index/index.tsx': [
      'export default () => (<>',
      '  <select />',
      '  {/* zhin-ui-ignore 6: 画布内的原生按钮，底线已自行满足 */}',
      '  <button />',
      '</>);',
    ].join('\n'),
    'plugins/utils/no-pages/package.json': pkg('@zhin.js/no-pages'),
  });
}

function staticGate(root: string) {
  const { gate } = readUiGate(root);
  const plugins = listOfficialPluginsWithPages(root);
  const reports = new Map(plugins.map((plugin) => [plugin, checkPluginPageUi(path.join(root, plugin))]));
  return { gate, plugins, result: evaluateStaticUiGate(gate, reports, formatPageUiFinding) };
}

describe('official plugin UI gate list', () => {
  it('the repository list covers every official plugin with pages, Sandbox pending with a reason', () => {
    const { gate, problems } = readUiGate(repoRoot);
    expect(problems).toEqual([]);
    expect(validateUiGate(gate, listOfficialPluginsWithPages(repoRoot))).toEqual([]);
    expect(gate.pending.map((entry: { plugin: string }) => entry.plugin)).toEqual(['plugins/adapters/sandbox']);
    expect(gate.pending[0].reason).toMatch(/D13/u);
  });

  it('every gated repository plugin passes rules 1–6', () => {
    const { gate } = readUiGate(repoRoot);
    for (const plugin of gate.gated) {
      expect(checkPluginPageUi(path.join(repoRoot, plugin)).findings, plugin).toEqual([]);
    }
  });

  it('rejects unknown fields so a check cannot be switched off per plugin or file', () => {
    const root = repoWith({ 'scripts/plugin-ui-gate.json': gateFile({ gated: [], pending: [], ignore: ['plugins/x'] }) });
    expect(readUiGate(root).problems.join('\n')).toMatch(/不认识的字段 ignore/u);
    const noReason = repoWith({ 'scripts/plugin-ui-gate.json': gateFile({ gated: [], pending: [{ plugin: 'plugins/x' }] }) });
    expect(readUiGate(noReason).problems.join('\n')).toMatch(/写明加入门禁的条件/u);
  });

  it('requires every plugin with pages to be listed, once, and no stale entries', () => {
    const problems = validateUiGate(
      { gated: ['plugins/utils/a', 'plugins/utils/gone'], pending: [{ plugin: 'plugins/utils/a', reason: 'x' }] },
      ['plugins/utils/a', 'plugins/utils/b'],
    ).map(({ plugin, message }: { plugin: string, message: string }) => `${plugin}: ${message}`);
    expect(problems.some((problem: string) => problem.startsWith('plugins/utils/a: 在门禁名单中出现了 2 次'))).toBe(true);
    expect(problems.some((problem: string) => problem.startsWith('plugins/utils/gone: 在门禁名单中，但不是'))).toBe(true);
    expect(problems.some((problem: string) => problem.startsWith('plugins/utils/b: 有 pages/ 但不在'))).toBe(true);
  });
});

describe('static gate (pnpm check:plugin)', () => {
  it('turns findings of gated plugins into errors and lists exemptions', () => {
    const root = fixtureRepo({ gated: ['plugins/utils/clean', 'plugins/utils/dirty'], pending: [] });
    const { plugins, result } = staticGate(root);
    expect(plugins).toEqual(['plugins/utils/clean', 'plugins/utils/dirty']);
    expect(result.errors.map((error: { plugin: string, rule?: number }) => [error.plugin, error.rule])).toEqual([['plugins/utils/dirty', 1]]);
    expect(result.reported).toEqual([]);
    expect(result.exemptions).toEqual([expect.objectContaining({ plugin: 'plugins/utils/dirty', rules: [6], line: 3, status: 'gated' })]);
    const summary = formatUiGateSummary('UI', result);
    expect(summary).toContain('### 错误（门禁中的插件）');
    expect(summary).toContain('### 豁免');
    expect(summary).toContain('画布内的原生按钮');
  });

  it('only reports findings of pending plugins', () => {
    const root = fixtureRepo({ gated: ['plugins/utils/clean'], pending: [{ plugin: 'plugins/utils/dirty', reason: '迁移中' }] });
    const { result } = staticGate(root);
    expect(result.errors).toEqual([]);
    expect(result.reported.map((item: { rule?: number }) => item.rule)).toEqual([1]);
    expect(result.exemptions[0].status).toBe('pending');
  });

  it('treats unused or malformed ignore comments of gated plugins as errors', () => {
    const root = repoWith({
      'plugins/utils/a/package.json': pkg('a'),
      'plugins/utils/a/pages/index/index.tsx': '// zhin-ui-ignore 1: 已经没有 select 了\nexport default () => <div />;\n',
    });
    const reports = new Map([['plugins/utils/a', checkPluginPageUi(path.join(root, 'plugins/utils/a'))]]);
    const result = evaluateStaticUiGate({ gated: ['plugins/utils/a'], pending: [] }, reports, formatPageUiFinding);
    expect(result.errors.map((error: { message: string }) => error.message).join('\n')).toMatch(/没有豁免任何违规/u);
  });
});

describe('audit gate (pnpm check:plugin-ui-audit)', () => {
  const gate = { gated: ['plugins/utils/clean'], pending: [{ plugin: 'plugins/utils/dirty', reason: '迁移中' }] };

  it('errors on gated violations, reports pending ones and lists exemptions', () => {
    const outcome = evaluateAuditUiGate(gate, {
      pages: [
        { plugin: 'plugins/utils/clean', page: 'index', violations: [{ check: 'touch-target', width: 375, theme: 'dark', message: '按钮 32px 高', selector: 'button' }] },
        { plugin: 'plugins/utils/dirty', page: 'index', violations: [{ check: 'type-scale', width: 1280, theme: 'light', message: '6 种字号' }], exemptions: [{ check: 'shadow', reason: '画布阴影', selector: 'canvas' }] },
      ],
    }, ['plugins/utils/clean', 'plugins/utils/dirty']);
    expect(outcome.errors.map((error: { plugin: string, check?: string }) => [error.plugin, error.check])).toEqual([['plugins/utils/clean', 'touch-target']]);
    expect(outcome.errors[0].message).toContain('375px dark');
    expect(outcome.reported.map((item: { check?: string }) => item.check)).toEqual(['type-scale']);
    expect(outcome.exemptions).toEqual([expect.objectContaining({ plugin: 'plugins/utils/dirty', check: 'shadow', reason: '画布阴影' })]);
  });

  it('fails when a gated plugin was not audited or the result is malformed', () => {
    expect(evaluateAuditUiGate(gate, { pages: [] }, ['plugins/utils/clean']).errors[0].message).toMatch(/没有返回/u);
    expect(evaluateAuditUiGate(gate, { nope: true }, []).errors[0].message).toMatch(/pages/u);
    expect(evaluateAuditUiGate(gate, { pages: [{ plugin: 'p', page: 'i', violations: [], exemptions: [{ check: 'x', reason: '' }] }] }, []).errors[0].message).toMatch(/reason/u);
  });

  it('calls auditPluginPages() with every official plugin and decides by the gate list', async () => {
    const root = fixtureRepo(gate);
    const moduleFile = path.join(root, 'audit.mjs');
    fs.writeFileSync(moduleFile, [
      'export async function auditPluginPages(request) {',
      '  globalThis.__zhinAuditRequest = request;',
      "  return { pages: request.plugins.map((p) => ({ plugin: p.plugin, page: 'index', violations: p.plugin.endsWith('dirty') ? [{ check: 'overflow', width: 375, theme: 'light', message: '横向滚动' }] : [] })) };",
      '}',
    ].join('\n'));
    const logs: string[] = [];
    const code = await runPluginUiAudit({ argv: ['--audit-module', moduleFile], env: {}, root, log: (line) => logs.push(line), error: (line) => logs.push(line) });
    expect(code).toBe(0);
    const request = (globalThis as { __zhinAuditRequest?: ReturnType<typeof buildAuditRequest> }).__zhinAuditRequest!;
    expect(request.widths).toEqual([375, 768, 1280, 1920]);
    expect(request.themes).toEqual(['light', 'dark']);
    expect(request.plugins.map((plugin) => [plugin.plugin, plugin.packageName, plugin.pages])).toEqual([
      ['plugins/utils/clean', '@zhin.js/clean', [{ name: 'index', entry: 'pages/index/index.tsx' }]],
      ['plugins/utils/dirty', '@zhin.js/dirty', [{ name: 'index', entry: 'pages/index/index.tsx' }]],
    ]);
    expect(logs.join('\n')).toContain('report only: plugins/utils/dirty');

    fs.writeFileSync(path.join(root, 'scripts/plugin-ui-gate.json'), gateFile({ gated: ['plugins/utils/clean', 'plugins/utils/dirty'], pending: [] }));
    expect(await runPluginUiAudit({ argv: ['--audit-module', moduleFile], env: {}, root, log: () => {}, error: () => {} })).toBe(1);
  });

  it('skips while the default audit module is missing, unless the audit is required', async () => {
    const root = fixtureRepo(gate);
    const logs: string[] = [];
    const env = { GITHUB_STEP_SUMMARY: path.join(root, 'summary.md') };
    expect(await runPluginUiAudit({ argv: [], env, root, log: (line) => logs.push(line), error: (line) => logs.push(line) })).toBe(0);
    expect(logs.join('\n')).toMatch(/skipped/u);
    expect(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8')).toContain('已跳过');
    expect(await runPluginUiAudit({ argv: ['--require-audit'], env: {}, root, log: () => {}, error: () => {} })).toBe(1);
    expect(await runPluginUiAudit({ argv: ['--audit-module', './missing-audit.mjs'], env: {}, root, log: () => {}, error: () => {} })).toBe(1);
  });
});
