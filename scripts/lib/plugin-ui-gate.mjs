/**
 * Official plugin UI gate (ADR 0063 D19「本仓库的官方插件」/ D20).
 *
 * One gate list (`scripts/plugin-ui-gate.json`) decides, per official plugin, whether page UI
 * problems are CI errors (`gated`) or only reported (`pending`). Two checks share it:
 * - `pnpm check:plugin`: the static rules 1–6 of `zhin plugin check`;
 * - `pnpm check:plugin-ui-audit`: the Playwright full audit from `@zhin.js/console-ui`.
 * Waivers are inline only (`// zhin-ui-ignore <rule>: <reason>`, `data-zhin-ui-ignore="<check>: <reason>"`);
 * the gate list has no switch that turns a check off for a plugin or a file.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const UI_GATE_FILE = 'scripts/plugin-ui-gate.json';

/** Directories whose children are official plugins (same list as scripts/check-plugin-spec.mjs). */
export const OFFICIAL_PLUGIN_ROOTS = Object.freeze([
  'plugins/adapters',
  'packages/host',
  'plugins/services',
  'plugins/features',
  'plugins/games',
  'plugins/utils',
]);

/**
 * @typedef {{ gated: string[], pending: { plugin: string, reason: string }[] }} UiGate
 * @typedef {{ plugin: string, message: string }} GateProblem
 */

/** Reads and shape-checks the gate list; problems are returned, not thrown. */
export function readUiGate(repoRoot, file = UI_GATE_FILE) {
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  } catch (error) {
    return { gate: { gated: [], pending: [] }, problems: [`${file} 无法读取：${error.message}`] };
  }
  const gated = Array.isArray(raw?.gated) ? raw.gated : (problems.push(`${file}: gated 必须是数组`), []);
  const pending = Array.isArray(raw?.pending) ? raw.pending : (problems.push(`${file}: pending 必须是数组`), []);
  for (const key of Object.keys(raw ?? {})) {
    if (!['$comment', 'gated', 'pending'].includes(key)) problems.push(`${file}: 不认识的字段 ${key}（门禁名单只有 gated / pending，不能按插件或文件关闭检查）`);
  }
  for (const entry of gated) {
    if (typeof entry !== 'string' || entry === '') problems.push(`${file}: gated 只能写插件目录字符串`);
  }
  for (const entry of pending) {
    const valid = entry && typeof entry === 'object' && typeof entry.plugin === 'string' && entry.plugin !== ''
      && typeof entry.reason === 'string' && entry.reason.trim() !== '' && Object.keys(entry).every((key) => key === 'plugin' || key === 'reason');
    if (!valid) problems.push(`${file}: pending 条目必须是 { "plugin", "reason" }，并写明加入门禁的条件`);
  }
  return {
    gate: {
      gated: gated.filter((entry) => typeof entry === 'string'),
      pending: pending.filter((entry) => entry && typeof entry.plugin === 'string'),
    },
    problems,
  };
}

/** Official plugins (repo-relative posix directories) that have a `pages/` directory. */
export function listOfficialPluginsWithPages(repoRoot, roots = OFFICIAL_PLUGIN_ROOTS) {
  const plugins = [];
  for (const root of roots) {
    let names;
    try {
      names = fs.readdirSync(path.join(repoRoot, root));
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const directory = path.join(repoRoot, root, name);
      if (fs.existsSync(path.join(directory, 'package.json')) && fs.statSync(path.join(directory, 'pages'), { throwIfNoEntry: false })?.isDirectory()) {
        plugins.push(`${root}/${name}`);
      }
    }
  }
  return plugins.sort();
}

/** Consistency of the gate list with the plugins on disk. */
export function validateUiGate(gate, pluginsWithPages) {
  const problems = [];
  const withPages = new Set(pluginsWithPages);
  const seen = new Map();
  for (const plugin of gate.gated) seen.set(plugin, [...(seen.get(plugin) ?? []), 'gated']);
  for (const { plugin } of gate.pending) seen.set(plugin, [...(seen.get(plugin) ?? []), 'pending']);
  for (const [plugin, lists] of seen) {
    if (lists.length > 1) problems.push({ plugin, message: `在门禁名单中出现了 ${lists.length} 次（${lists.join('、')}）` });
    if (!withPages.has(plugin)) problems.push({ plugin, message: '在门禁名单中，但不是有 pages/ 的官方插件（目录改名或页面已删除时同步更新名单）' });
  }
  for (const plugin of pluginsWithPages) {
    if (!seen.has(plugin)) {
      problems.push({ plugin, message: `有 pages/ 但不在 ${UI_GATE_FILE} 中：页面符合 ADR 0063 第 1–6 条时加入 gated，否则加入 pending 并写明加入门禁的条件` });
    }
  }
  return problems;
}

function gateStatus(gate, plugin) {
  if (gate.gated.includes(plugin)) return 'gated';
  return 'pending';
}

/**
 * Static rules 1–6 under the gate list.
 * @param {UiGate} gate
 * @param {Map<string, import('../../basic/cli/src/plugin-check/page-checks.ts').PageUiReport>} reports keyed by plugin directory
 * @param {(finding: object) => string} formatFinding
 */
export function evaluateStaticUiGate(gate, reports, formatFinding) {
  const errors = [];
  const reported = [];
  const exemptions = [];
  const auditExemptions = [];
  for (const [plugin, report] of [...reports].sort(([a], [b]) => a.localeCompare(b))) {
    const status = gateStatus(gate, plugin);
    const target = status === 'gated' ? errors : reported;
    if (report.skipped) errors.push({ plugin, message: report.skipped });
    for (const finding of report.findings) target.push({ plugin, rule: finding.rule, message: formatFinding(finding) });
    for (const problem of report.directiveProblems) target.push({ plugin, message: `${problem.file}:${problem.line} ${problem.message}` });
    for (const exemption of report.exemptions) {
      exemptions.push({ plugin, status, rules: exemption.rules, file: exemption.file, line: exemption.line, reason: exemption.reason });
    }
    for (const exemption of report.auditExemptions) {
      auditExemptions.push({ plugin, status, check: exemption.check, file: exemption.file, line: exemption.line, reason: exemption.reason });
    }
  }
  return { errors, reported, exemptions, auditExemptions };
}

/**
 * Shape `auditPluginPages()` of `@zhin.js/console-ui` must resolve to (see docs/authoring/console-pages.md).
 * @typedef {{ check: string, width: number, theme: 'light' | 'dark', message: string, selector?: string }} AuditViolation
 * @typedef {{ check: string, reason: string, selector?: string }} AuditExemption
 * @typedef {{ plugin: string, page: string, mounted?: boolean, skipped?: string, violations: AuditViolation[], exemptions?: AuditExemption[] }} AuditPageResult
 */

/** Validates the audit result shape; returns the problems (empty when valid). */
export function auditResultProblems(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.pages)) return ['审计结果必须是 { pages: AuditPageResult[] }'];
  const problems = [];
  result.pages.forEach((page, index) => {
    const where = `pages[${index}]`;
    if (!page || typeof page.plugin !== 'string' || typeof page.page !== 'string') problems.push(`${where} 缺少 plugin / page`);
    if (!Array.isArray(page?.violations)) problems.push(`${where}.violations 必须是数组`);
    for (const violation of page?.violations ?? []) {
      if (typeof violation?.check !== 'string' || typeof violation?.message !== 'string') problems.push(`${where}.violations 条目缺少 check / message`);
    }
    for (const exemption of page?.exemptions ?? []) {
      if (typeof exemption?.check !== 'string' || typeof exemption?.reason !== 'string' || exemption.reason.trim() === '') {
        problems.push(`${where}.exemptions 条目必须写明 check 与 reason`);
      }
    }
  });
  return problems;
}

/**
 * Playwright audit results under the gate list. Every gated plugin must have been audited:
 * a gated plugin missing from the result is an error.
 * @param {UiGate} gate
 * @param {{ pages: AuditPageResult[] }} result
 * @param {string[]} expectedPlugins plugins handed to the audit
 */
export function evaluateAuditUiGate(gate, result, expectedPlugins) {
  const errors = auditResultProblems(result).map((message) => ({ plugin: '(audit)', message }));
  const reported = [];
  const exemptions = [];
  if (errors.length > 0) return { errors, reported, exemptions };
  const audited = new Set(result.pages.map((page) => page.plugin));
  for (const plugin of expectedPlugins) {
    if (gate.gated.includes(plugin) && !audited.has(plugin)) errors.push({ plugin, message: '在门禁中，但审计没有返回它的页面结果' });
  }
  for (const page of result.pages) {
    const status = gateStatus(gate, page.plugin);
    const target = status === 'gated' ? errors : reported;
    // A page that was not mounted was not audited: for a gated plugin that is an error, not a pass.
    if (page.skipped || page.mounted === false) {
      target.push({ plugin: page.plugin, check: 'mount', message: `${page.page} 没有挂载，未被审计${page.skipped ? `：${page.skipped}` : ''}` });
    }
    for (const violation of page.violations) {
      const where = [violation.width ? `${violation.width}px` : '', violation.theme ?? ''].filter(Boolean).join(' ');
      target.push({ plugin: page.plugin, check: violation.check, message: `${page.page} [${violation.check}${where ? ` ${where}` : ''}] ${violation.message}${violation.selector ? `（${violation.selector}）` : ''}` });
    }
    for (const exemption of page.exemptions ?? []) {
      exemptions.push({ plugin: page.plugin, status, check: exemption.check, page: page.page, selector: exemption.selector, reason: exemption.reason });
    }
  }
  return { errors, reported, exemptions };
}

function markdownCell(text) {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** Markdown for `$GITHUB_STEP_SUMMARY`: violations and exemptions by plugin and rule. */
export function formatUiGateSummary(title, { errors, reported, exemptions, auditExemptions = [] }) {
  const lines = [`## ${title}`, ''];
  lines.push(`错误 ${errors.length} 项，只报告 ${reported.length} 项，豁免 ${exemptions.length + auditExemptions.length} 项。`, '');
  const table = (heading, rows, columns) => {
    if (rows.length === 0) return;
    lines.push(`### ${heading}`, '', `| ${columns.map(([label]) => label).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of rows) lines.push(`| ${columns.map(([, pick]) => markdownCell(pick(row) ?? '')).join(' | ')} |`);
    lines.push('');
  };
  const ruleOf = (row) => row.rule !== undefined ? `第 ${row.rule} 条` : row.check ?? '';
  table('错误（门禁中的插件）', errors, [['插件', (row) => row.plugin], ['检查项', ruleOf], ['说明', (row) => row.message]]);
  table('只报告（尚未进入门禁）', reported, [['插件', (row) => row.plugin], ['检查项', ruleOf], ['说明', (row) => row.message]]);
  table('豁免', [...exemptions, ...auditExemptions], [
    ['插件', (row) => row.plugin],
    ['检查项', (row) => row.rules ? `第 ${row.rules.join(',')} 条` : row.check],
    ['位置', (row) => row.file ? `${row.file}:${row.line}` : [row.page, row.selector].filter(Boolean).join(' ')],
    ['理由', (row) => row.reason],
  ]);
  return `${lines.join('\n')}\n`;
}

/** Appends to the GitHub Actions job summary when running in Actions. */
export function writeStepSummary(markdown, env = process.env) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
  } catch {
    // the summary is best effort
  }
}

/** Loads the page checks of `zhin plugin check` straight from source (no CLI build needed). */
export async function loadPageChecks(repoRoot) {
  const { tsImport } = await import('tsx/esm/api');
  return tsImport(pathToFileURL(path.join(repoRoot, 'basic/cli/src/plugin-check/page-checks.ts')).href, import.meta.url);
}
