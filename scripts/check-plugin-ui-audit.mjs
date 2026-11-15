#!/usr/bin/env node
/**
 * Harness: Playwright 全项审计对官方插件页面的门禁（ADR 0063 D20 第 3 条、D19「本仓库的官方插件」）。
 *
 * 审计工具由 @zhin.js/console-ui 提供（ADR 0063 P1b）：本脚本加载其中的 `auditPluginPages()`，
 * 交给它所有有 pages/ 的官方插件，再按 scripts/plugin-ui-gate.json 判定：gated 的插件违规即失败，
 * pending 的只出报告；运行摘要（$GITHUB_STEP_SUMMARY）按插件和检查项列出违规与豁免。
 *
 * 审计模块：--audit-module <路径或包名>，或环境变量 ZHIN_PLUGIN_UI_AUDIT_MODULE，
 * 默认 @zhin.js/console-ui/audit。默认模块尚未提供时只打印提示并以 0 退出；加 --require-audit
 * 或显式指定模块时，加载不到即失败。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  evaluateAuditUiGate,
  formatUiGateSummary,
  listOfficialPluginsWithPages,
  readUiGate,
  validateUiGate,
  writeStepSummary,
} from './lib/plugin-ui-gate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_AUDIT_MODULE = '@zhin.js/console-ui/audit';
export const AUDIT_WIDTHS = Object.freeze([375, 768, 1280, 1920]);
export const AUDIT_THEMES = Object.freeze(['light', 'dark']);

/** Pages of an official plugin: `pages/<name>/index.(ts|tsx|js|jsx)`. */
export function listPluginPages(pluginDirectory) {
  const pagesDirectory = path.join(pluginDirectory, 'pages');
  const pages = [];
  for (const name of fs.readdirSync(pagesDirectory).sort()) {
    const entry = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'].find((file) => fs.existsSync(path.join(pagesDirectory, name, file)));
    if (entry) pages.push({ name, entry: `pages/${name}/${entry}` });
  }
  return pages;
}

/** The request handed to `auditPluginPages()`. */
export function buildAuditRequest(root, plugins) {
  return {
    repoRoot: root,
    widths: [...AUDIT_WIDTHS],
    themes: [...AUDIT_THEMES],
    plugins: plugins.map((plugin) => {
      const directory = path.join(root, plugin);
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      return { plugin, directory, packageName: manifest.name, pages: listPluginPages(directory) };
    }),
  };
}

async function importAuditModule(specifier) {
  const resolved = specifier.startsWith('.') || path.isAbsolute(specifier)
    ? pathToFileURL(path.resolve(specifier)).href
    : specifier;
  if (resolved.startsWith('file:') && !fs.existsSync(fileURLToPath(resolved))) return undefined;
  try {
    return await import(resolved);
  } catch (error) {
    // Only the audit module itself being absent means "not available yet"; a missing dependency of it is a failure.
    if (resolved.startsWith('file:')) throw error;
    const target = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const missing = error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
      || new RegExp(`^Cannot find (?:package|module) '${escaped}(?:/[^']*)?'`, 'u').test(String(error?.message));
    if (missing) return undefined;
    throw error;
  }
}

/**
 * Runs the gate. Returns the process exit code.
 * @param {{ argv?: string[], env?: NodeJS.ProcessEnv, root?: string, log?: (line: string) => void, error?: (line: string) => void }} options
 */
export async function runPluginUiAudit({ argv = process.argv.slice(2), env = process.env, root = repoRoot, log = console.log, error = console.error } = {}) {
  const moduleFlag = argv.indexOf('--audit-module');
  const specifier = moduleFlag >= 0 ? argv[moduleFlag + 1] : env.ZHIN_PLUGIN_UI_AUDIT_MODULE || DEFAULT_AUDIT_MODULE;
  // An explicitly named module must load; only the default one may be absent (until P1b ships it).
  const requireAudit = argv.includes('--require-audit') || moduleFlag >= 0 || Boolean(env.ZHIN_PLUGIN_UI_AUDIT_MODULE);

  const { gate, problems } = readUiGate(root);
  const plugins = listOfficialPluginsWithPages(root);
  const listProblems = [...problems, ...validateUiGate(gate, plugins).map(({ plugin, message }) => `${plugin}: ${message}`)];
  if (listProblems.length > 0) {
    for (const problem of listProblems) error(`  ${problem}`);
    error('Plugin UI audit: FAILED (gate list)');
    return 1;
  }

  const auditModule = await importAuditModule(specifier);
  if (typeof auditModule?.auditPluginPages !== 'function') {
    const message = auditModule
      ? `${specifier} 没有导出 auditPluginPages()`
      : `未找到审计模块 ${specifier}（ADR 0063 P1b 在 @zhin.js/console-ui 中提供）`;
    if (requireAudit || auditModule) {
      error(`Plugin UI audit: FAILED — ${message}`);
      return 1;
    }
    log(`Plugin UI audit: skipped — ${message}；门禁名单：${gate.gated.length} gated，${gate.pending.length} pending`);
    writeStepSummary(`## 官方插件页面 UI 审计\n\n已跳过：${message}。\n`, env);
    return 0;
  }

  const result = await auditModule.auditPluginPages(buildAuditRequest(root, plugins));
  const outcome = evaluateAuditUiGate(gate, result, plugins);
  writeStepSummary(formatUiGateSummary('官方插件页面 UI 审计（Playwright 全项）', outcome), env);
  for (const item of outcome.reported) log(`  report only: ${item.plugin} ${item.message}`);
  for (const item of outcome.exemptions) log(`  exemption: ${item.plugin} ${item.page} ${item.check}: ${item.reason}`);
  if (outcome.errors.length > 0) {
    for (const item of outcome.errors) error(`  ${item.plugin}: ${item.message}`);
    error(`Plugin UI audit: FAILED (${outcome.errors.length} error(s))`);
    return 1;
  }
  log(`Plugin UI audit: OK (${gate.gated.length} gated, ${outcome.reported.length} report-only finding(s), ${outcome.exemptions.length} exemption(s))`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPluginUiAudit();
}
