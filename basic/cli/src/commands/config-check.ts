import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import {
  applyConfigFixes,
  runConfigCheck,
  summarizeIssues,
  type ConfigIssue,
} from '../utils/config-check.js';
import { getLoadedConfigRevision, prepareConfigSave } from '../utils/config-file.js';
import { logger } from '../utils/logger.js';
import { loadRuntimeEnvironmentLayers } from '../plugin-runtime/start/module.js';
import { validateOfflineConfiguration, commitOfflineConfiguration } from '../utils/config-offline.js';

function printIssue(issue: ConfigIssue): void {
  const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warn' ? '⚠️' : 'ℹ️';
  const color =
    issue.severity === 'error'
      ? chalk.red
      : issue.severity === 'warn'
        ? chalk.yellow
        : chalk.blue;
  const location = issue.path ? chalk.gray(` (${issue.path})`) : '';
  console.log(`${icon} ${color(issue.message)}${location}`);
  if (issue.fixHint) {
    console.log(`   ${chalk.gray('建议:')} ${chalk.cyan(issue.fixHint)}`);
  }
}

export function createConfigCheckCommand(): Command { return new Command('check')
  .alias('validate')
  .description('检查配置文件并可选自动修复旧版字段')
  .option('--fix', '自动修复可安全迁移的配置项并写回文件')
  .option('--json', '以 JSON 输出检查结果')
  .option('--strict', '将警告视为错误（用于 CI）')
  .option('--offline', '允许 --fix 离线校验后保存，不请求 Host 生效')
  .option('--environment <name>', '加载 .env.<name> 环境覆盖', 'development')
  .action(async (_options: unknown, command: Command) => {
    const options = command.optsWithGlobals<{ fix?: boolean; offline?: boolean; live?: string; json?: boolean; strict?: boolean; environment: string }>();
    if (options.fix && (!options.offline || options.live)) throw new TypeError('config check --fix 仅允许显式 --offline；不会在线旁路修改本地文件');
    const cwd = process.cwd();
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(options.environment)) {
      throw new TypeError(`Invalid environment name: ${options.environment || '<empty>'}`);
    }
    const layers = await loadRuntimeEnvironmentLayers(cwd, options.environment);
    const env = {
      ...layers.base,
      ...layers.environments?.[options.environment],
    };

    let result = await runConfigCheck(cwd, env);

    if (options.fix && result.configFile && Object.keys(result.config).length > 0) {
      const { config: fixed, fixes } = applyConfigFixes(result.config, cwd);
      if (fixes.length > 0) {
        const file = path.join(cwd, result.configFile);
        const expectedRevision = getLoadedConfigRevision(result.config);
        if (!expectedRevision) throw new Error('离线修复需要已读取的配置源版本');
        const prepared = await prepareConfigSave(file, fixed, result.config);
        try { await validateOfflineConfiguration(cwd, prepared?.document ?? fixed, options.environment, prepared?.pluginOrder); }
        catch (error) { await prepared?.rollback(); throw error; }
        if (prepared) {
          const saved = await commitOfflineConfiguration(prepared, expectedRevision);
          if (saved.status === 'unconfirmed') {
            if (!options.json) console.log(saved.message);
            console.log(JSON.stringify(saved, null, options.json ? undefined : 2));
            process.exitCode = 1;
            return;
          }
        } else {
          // Declaration imports can touch the source even on a no-op candidate.
          await prepareConfigSave(file, fixed, result.config);
        }
        result.fixesApplied = fixes;
        result = await runConfigCheck(cwd, env);
        result.fixesApplied = fixes;
      } else {
        logger.info('未发现可自动修复的配置项');
      }
    }

    const summary = summarizeIssues(result.issues, !!options.strict);

    if (options.json) {
      console.log(JSON.stringify({
        success: summary.exitCode === 0,
        configFile: result.configFile,
        fixesApplied: result.fixesApplied,
        summary,
        issues: result.issues,
      }, null, 2));
      if (summary.exitCode !== 0) process.exit(summary.exitCode);
      return;
    }

    console.log(chalk.bold('\n🔍 Zhin 配置检查\n'));
    if (result.configFile) {
      console.log(`${chalk.gray('文件:')} ${result.configFile}`);
    }
    if (result.fixesApplied.length > 0) {
      console.log(chalk.green(`\n已应用 ${result.fixesApplied.length} 项修复:`));
      for (const fix of result.fixesApplied) {
        console.log(`  ${chalk.green('•')} ${fix}`);
      }
      console.log('');
    }
    if (result.issues.length === 0) {
      console.log(chalk.green('✅ 配置检查通过'));
    } else {
      for (const issue of result.issues) {
        printIssue(issue);
      }
      console.log('');
      console.log(chalk.gray(`共 ${summary.errors} 个错误、${summary.warnings} 个警告、${summary.infos} 条提示`));
      if (summary.errors > 0) {
        console.log(chalk.red('\n请修复错误后再启动 bot'));
      } else if (options.strict) {
        console.log(chalk.yellow('\n--strict 模式下存在警告'));
      } else if (summary.warnings > 0) {
        console.log(chalk.yellow('\n可运行 ') + chalk.cyan('zhin config check --fix --offline') + chalk.yellow(' 尝试离线校验后修复（不会请求生效）'));
      }
    }

    if (summary.exitCode !== 0) process.exit(summary.exitCode);
  }); }

export const configCheckCommand = createConfigCheckCommand();
