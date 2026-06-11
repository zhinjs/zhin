import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import {
  applyConfigFixes,
  runConfigCheck,
  summarizeIssues,
  type ConfigIssue,
} from '../utils/config-check.js';
import { saveConfig } from '../utils/config-file.js';
import { logger } from '../utils/logger.js';

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

export const configCheckCommand = new Command('check')
  .alias('validate')
  .description('检查配置文件并可选自动修复旧版字段')
  .option('--fix', '自动修复可安全迁移的配置项并写回文件')
  .option('--json', '以 JSON 输出检查结果')
  .option('--strict', '将警告视为错误（用于 CI）')
  .action(async (options: { fix?: boolean; json?: boolean; strict?: boolean }) => {
    const cwd = process.cwd();
    const envPath = path.join(cwd, '.env');
    if (await fs.pathExists(envPath)) {
      dotenv.config({ path: envPath });
    }

    let result = await runConfigCheck(cwd, process.env);

    if (options.fix && result.configFile && Object.keys(result.config).length > 0) {
      const { config: fixed, fixes } = applyConfigFixes(result.config, cwd);
      if (fixes.length > 0) {
        await saveConfig(path.join(cwd, result.configFile), fixed);
        result.fixesApplied = fixes;
        result = await runConfigCheck(cwd, process.env);
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
        console.log(chalk.yellow('\n可运行 ') + chalk.cyan('zhin config check --fix') + chalk.yellow(' 尝试自动修复'));
      }
    }

    if (summary.exitCode !== 0) process.exit(summary.exitCode);
  });
