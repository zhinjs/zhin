import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { formatCompact } from '@zhin.js/logger';
import {
  diagnoseAIDependencies,
  formatAIDependencyFixCommand,
  isAiEnabledInConfig,
  mergeDependenciesIntoPackageJson,
  packagesNeedingAiStackFix,
  diagnoseOptionalPeers,
  formatOptionalPeerFixCommand,
  diagnoseUpgradeToL4,
  diagnoseZhinStackDependencies,
  formatZhinStackFixCommand,
  packagesNeedingZhinStackFix,
  applyProjectConfigPlan,
  createProjectConfigPlan,
  loadProjectConfig,
  diagnoseConsoleConfig,
  type ConsoleConfigDiagnosis,
} from '@zhin.js/scaffold-wizard';
import { logger } from '../utils/logger.js';
import { formatNodeRequirementMessage, isNodeVersionSupported } from '../utils/node-requirements.js';
import { findConfigFile, readConfig } from '../utils/config-file.js';
import { findMissingEndpointFields, loadPluginSchemaJson } from '../utils/adapter-endpoints-check.js';

const execAsync = promisify(exec);
const CONSOLE_URL = 'https://console.zhin.dev';
const TROUBLESHOOTING_URL = 'https://zhin.js.org/troubleshooting/';
const SANDBOX_PLUGIN = '@zhin.js/adapter-sandbox';

interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

export const doctorCommand = new Command('doctor')
  .alias('health')
  .description('检查系统环境和项目配置')
  .option('--fix', '自动修复可修复的问题')
  .option('--upgrade-l4', '诊断 minimal→L4 升级路径（AI 栈 + optional peer）')
  .action(async (options) => {
    console.log(chalk.blue('🏥 Zhin.js 健康检查'));
    console.log('');

    const results: CheckResult[] = [];
    const cwd = process.cwd();

    if (options.upgradeL4) {
      const configPath = findConfigFile(cwd);
      let config: Record<string, unknown> = {};
      if (configPath) {
        try {
          config = await readConfig(path.join(cwd, configPath)) as Record<string, unknown>;
        } catch {
          config = {};
        }
      }
      const upgrade = diagnoseUpgradeToL4(cwd, config);
      console.log(chalk.cyan('L4 升级诊断'));
      if (upgrade.missingAiDeps.length > 0) {
        console.log(chalk.yellow(`  缺少 AI 依赖: ${upgrade.missingAiDeps.join(', ')}`));
      } else {
        console.log(chalk.green('  AI 依赖: 已就绪'));
      }
      if (upgrade.missingOptionalPeers.length > 0) {
        console.log(chalk.yellow(`  缺少 optional peer: ${upgrade.missingOptionalPeers.join(', ')}`));
      }
      if (upgrade.fixCommand) {
        console.log(chalk.gray(`  修复: ${upgrade.fixCommand}`));
      }
      console.log(chalk.gray('\n建议配置增量:'));
      for (const line of upgrade.configSnippets) {
        console.log(chalk.gray(`  ${line}`));
      }
      console.log('');
      if (options.fix && upgrade.fixCommand) {
        const deps: Record<string, string> = {};
        for (const name of upgrade.missingAiDeps) {
          deps[name] = 'latest';
        }
        if (Object.keys(deps).length > 0) {
          await mergeDependenciesIntoPackageJson(cwd, deps);
        }
        for (const peer of [upgrade.optionalPeers.speech, upgrade.optionalPeers.htmlRenderer]) {
          if (peer && peer.missingFromPackageJson.length > 0) {
            await mergeDependenciesIntoPackageJson(cwd, { [peer.packageName]: 'latest' });
          }
        }
        console.log(chalk.green('已写入 package.json，请运行 pnpm install'));
      }
      return;
    }

    // 1. 检查 Node.js 版本
    const nodeVersion = process.version;
    const nodeOk = isNodeVersionSupported(nodeVersion);
    results.push({
      name: 'Node.js 版本',
      status: nodeOk ? 'ok' : 'error',
      message: formatNodeRequirementMessage(nodeVersion),
      fix: nodeOk ? undefined : '请升级 Node.js（^20.19.0 或 >=22.12.0）: https://nodejs.org 或 nvm install 22',
    });

    // 2. 检查 pnpm（可用性与版本，要求 >=9）
    try {
      const { stdout } = await execAsync('pnpm --version');
      const pnpmVersion = stdout.trim();
      const pnpmMajor = parseInt(pnpmVersion.split('.')[0], 10);
      const pnpmOk = Number.isFinite(pnpmMajor) && pnpmMajor >= 9;
      results.push({
        name: 'pnpm',
        status: pnpmOk ? 'ok' : 'error',
        message: pnpmOk ? `v${pnpmVersion}` : `v${pnpmVersion}（需要 >=9）`,
        fix: pnpmOk ? undefined : 'npm install -g pnpm@latest 或 corepack enable'
      });
    } catch {
      results.push({
        name: 'pnpm',
        status: 'error',
        message: '未安装',
        fix: 'npm install -g pnpm（或 corepack enable && corepack prepare pnpm@latest --activate）'
      });
    }

    // 3. 检查配置文件（存在且可解析；解析失败给出行号）
    let existingConfig = findConfigFile(cwd) ?? undefined;
    let loadedConfig: Record<string, unknown> | null = null;
    let configParseFailed = false;

    if (existingConfig) {
      try {
        await readConfig(path.join(cwd, existingConfig));
        results.push({
          name: '配置文件',
          status: 'ok',
          message: `${existingConfig} 可正常解析`
        });
      } catch (err) {
        configParseFailed = true;
        const line = extractConfigErrorLine(err);
        const brief = (err instanceof Error ? err.message : String(err)).split('\n')[0];
        results.push({
          name: '配置文件',
          status: 'error',
          message: `${existingConfig} 解析失败${line ? `（第 ${line} 行）` : ''}: ${brief}`,
          fix: `修复 ${existingConfig} 语法错误后重跑 zhin doctor`
        });
      }
    } else {
      results.push({
        name: '配置文件',
        status: 'warn',
        message: '未找到配置文件',
        fix: options.fix ? '将创建默认配置' : 'zhin setup'
      });
      
      if (options.fix) {
        // 创建默认配置
        await createDefaultConfig(cwd);
        existingConfig = 'zhin.config.yml';
        logger.info(formatCompact( { cmd: 'doctor', op: 'create_config', file: 'zhin.config.yml' }));
      }
    }

    if (existingConfig && !configParseFailed) {
      const configPath = path.join(cwd, existingConfig);
      try {
        const loaded = loadProjectConfig(cwd, configPath);
        loadedConfig = loaded.status === 'loaded'
          ? loaded.config
          : await readConfig(configPath) as Record<string, unknown>;
        let diagnosis: ConsoleConfigDiagnosis = diagnoseConsoleConfig(loadedConfig);
        const canFixConfig = loaded.status === 'loaded' && loaded.writable;

        if (options.fix && canFixConfig) {
          const plan = createProjectConfigPlan({
            loaded,
            ensureConsole: true,
            ensureSandbox: true,
            ensureHttp: true,
            migrateAiLegacy: true,
          });
          if (await applyProjectConfigPlan(plan)) {
            loadedConfig = plan.after;
            diagnosis = diagnoseConsoleConfig(loadedConfig);
            logger.info(formatCompact({ cmd: 'doctor', op: 'fix_console_config', file: existingConfig }));
          }
        }

        if (diagnosis.missingSandboxPlugin) {
          results.push({
            name: 'Sandbox 首跑',
            status: 'warn',
            message: '未启用 @zhin.js/adapter-sandbox，首跑沙盒页不可用',
            fix: options.fix
              ? (canFixConfig ? '已写入配置' : `请手动添加到 ${existingConfig}`)
              : `zhin install ${SANDBOX_PLUGIN} 或查看 ${TROUBLESHOOTING_URL}`,
          });
        } else {
          results.push({
            name: 'Sandbox 首跑',
            status: 'ok',
            message: 'Sandbox 插件已启用',
          });
        }

        if (diagnosis.missingConsoleOrigin || diagnosis.missingHttpToken) {
          const details = [
            diagnosis.missingConsoleOrigin ? `缺少 CORS Origin ${CONSOLE_URL}` : null,
            diagnosis.missingHttpToken ? '缺少 http.token' : null,
          ].filter(Boolean).join('；');
          results.push({
            name: 'Console 登录条件',
            status: 'warn',
            message: details,
            fix: options.fix
              ? (canFixConfig ? '已补全配置' : `请手动更新 ${existingConfig}`)
              : `检查 http.token / http.corsOrigins，见 ${TROUBLESHOOTING_URL}`,
          });
        } else {
          results.push({
            name: 'Console 登录条件',
            status: 'ok',
            message: `Token 与 ${CONSOLE_URL} CORS 已配置`,
          });
        }
      } catch {
        results.push({
          name: 'Console 首跑配置',
          status: 'warn',
          message: '无法读取配置以检查 Console / Sandbox 条件',
          fix: TROUBLESHOOTING_URL,
        });
      }
    }

    // 4. 检查引导文件（SOUL/TOOLS/AGENTS 是 AI 人格与记忆文件，仅启用 AI 时检查，
    // 避免 IM-only 首跑项目收到误导性警告）
    let aiEnabledForBootstrap = false;
    try {
      const configForBootstrap: Record<string, unknown> | null = loadedConfig
        ?? (existingConfig ? await readConfig(path.join(cwd, existingConfig)) as Record<string, unknown> : null);
      aiEnabledForBootstrap = configForBootstrap ? isAiEnabledInConfig(configForBootstrap) : false;
    } catch {
      aiEnabledForBootstrap = false;
    }
    if (aiEnabledForBootstrap) {
    const bootstrapFiles = ['SOUL.md', 'TOOLS.md', 'AGENTS.md'];
    const missingBootstrap: string[] = [];
    
    for (const file of bootstrapFiles) {
      const filePath = path.join(cwd, file);
      if (!fs.existsSync(filePath)) {
        missingBootstrap.push(file);
      }
    }
    
    if (missingBootstrap.length === 0) {
      results.push({
        name: '引导文件',
        status: 'ok',
        message: '所有引导文件都存在'
      });
    } else {
      results.push({
        name: '引导文件',
        status: 'warn',
        message: `缺少: ${missingBootstrap.join(', ')}`,
        fix: options.fix ? '将创建缺失的引导文件' : 'zhin setup --bootstrap'
      });
      
      if (options.fix) {
        await createMissingBootstrapFiles(cwd, missingBootstrap);
        logger.info(formatCompact( { cmd: 'doctor', op: 'create_bootstrap', files: missingBootstrap.join(', ') }));
      }
    }
    }

    // 5. 检查 package.json
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = await fs.readJSON(pkgPath);
        const hasZhin = pkg.dependencies?.['zhin.js'] || pkg.devDependencies?.['zhin.js'];
        
        results.push({
          name: 'package.json',
          status: hasZhin ? 'ok' : 'warn',
          message: hasZhin ? '已配置 zhin.js' : '未安装 zhin.js',
          fix: hasZhin ? undefined : 'pnpm install zhin.js'
        });
      } catch (err: unknown) {
        results.push({
          name: 'package.json',
          status: 'error',
          message: `解析失败: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    } else {
      results.push({
        name: 'package.json',
        status: 'warn',
        message: '不存在',
        fix: 'pnpm init'
      });
    }

    // 5b. 检查 Zhin 生态依赖（zhin.js / plugins / database）
    if (existingConfig && !configParseFailed) {
      try {
        const config = loadedConfig ?? await readConfig(path.join(cwd, existingConfig));
        const pkgPath = path.join(cwd, 'package.json');
        const pkg = fs.existsSync(pkgPath) ? await fs.readJSON(pkgPath) : {};
        const zhinDiagnosis = diagnoseZhinStackDependencies(cwd, config as Record<string, unknown>, pkg);
        const zhinFixPackages = packagesNeedingZhinStackFix(zhinDiagnosis);
        if (zhinFixPackages.length > 0) {
          const fixCmd = formatZhinStackFixCommand(zhinFixPackages, zhinDiagnosis.required);
          const detailParts = [
            zhinDiagnosis.missingFromPackageJson.length > 0
              ? `缺少: ${zhinDiagnosis.missingFromPackageJson.join(', ')}`
              : '',
            zhinDiagnosis.outdatedInPackageJson.length > 0
              ? `版本过旧: ${zhinDiagnosis.outdatedInPackageJson.join(', ')}`
              : '',
            zhinDiagnosis.incompatibleInstalled.map((issue) => issue.reason).join('；'),
          ].filter(Boolean);
          results.push({
            name: 'Zhin 生态依赖',
            status: 'error',
            message: detailParts.join('；') || 'package.json 与 zhin.config 不匹配',
            fix: options.fix ? '将写入 package.json' : fixCmd,
          });
          if (options.fix) {
            const changed = await mergeDependenciesIntoPackageJson(cwd, zhinDiagnosis.required);
            if (changed) {
              logger.info(formatCompact({
                cmd: 'doctor',
                op: 'add_zhin_deps',
                packages: zhinFixPackages.join(','),
              }));
            }
          }
        } else if (zhinDiagnosis.notInstalled.length > 0) {
          results.push({
            name: 'Zhin 生态依赖',
            status: 'warn',
            message: `已声明但未安装: ${zhinDiagnosis.notInstalled.join(', ')}`,
            fix: 'pnpm install',
          });
        } else {
          results.push({
            name: 'Zhin 生态依赖',
            status: 'ok',
            message: 'zhin.js 与配置中的 @zhin.js/* 插件已对齐',
          });
        }
      } catch {
        results.push({
          name: 'Zhin 生态依赖',
          status: 'warn',
          message: '无法读取配置以检查 Zhin 生态依赖',
        });
      }
    }

    // 6. 检查 AI 依赖（zhin.js 4.x：配置启用 AI 时需单独安装 agent 栈）
    if (existingConfig && !configParseFailed) {
      try {
        const config = loadedConfig ?? await readConfig(path.join(cwd, existingConfig));
        if (isAiEnabledInConfig(config)) {
          const aiDiagnosis = diagnoseAIDependencies(cwd, config);
          if (aiDiagnosis) {
            const providerLabel = aiDiagnosis.provider ? ` (${aiDiagnosis.provider})` : '';
            const fixPackages = packagesNeedingAiStackFix(aiDiagnosis);
            const incompatibleMsg = aiDiagnosis.incompatibleInstalled
              .map((issue) => issue.reason)
              .join('；');
            const outdatedMsg = aiDiagnosis.outdatedInPackageJson.length > 0
              ? `版本过旧: ${aiDiagnosis.outdatedInPackageJson.join(', ')}`
              : '';

            if (fixPackages.length > 0) {
              const fixCmd = formatAIDependencyFixCommand(fixPackages, aiDiagnosis.required);
              const detailParts = [
                aiDiagnosis.missingFromPackageJson.length > 0
                  ? `缺少: ${aiDiagnosis.missingFromPackageJson.join(', ')}`
                  : '',
                outdatedMsg,
                incompatibleMsg,
              ].filter(Boolean);
              results.push({
                name: 'AI 依赖',
                status: 'error',
                message: `已启用 AI${providerLabel}${detailParts.length ? `，${detailParts.join('；')}` : ''}`,
                fix: options.fix ? '将写入 package.json' : fixCmd,
              });
              if (options.fix) {
                const changed = await mergeDependenciesIntoPackageJson(cwd, aiDiagnosis.required);
                if (changed) {
                  logger.info(formatCompact({
                    cmd: 'doctor',
                    op: 'add_ai_deps',
                    packages: fixPackages.join(','),
                  }));
                }
              }
            } else if (aiDiagnosis.notInstalled.length > 0) {
              results.push({
                name: 'AI 依赖',
                status: 'warn',
                message: `已声明但未安装: ${aiDiagnosis.notInstalled.join(', ')}`,
                fix: 'pnpm install',
              });
            } else {
              results.push({
                name: 'AI 依赖',
                status: 'ok',
                message: `AI 栈已就绪${providerLabel}`,
              });
            }
          }
        }
      } catch {
        results.push({
          name: 'AI 依赖',
          status: 'warn',
          message: '无法读取配置以检查 AI 依赖',
        });
      }

      // 6b. optional peer（speech / html-renderer）
      try {
        const config = loadedConfig ?? await readConfig(path.join(cwd, existingConfig));
        const peerDiagnosis = diagnoseOptionalPeers(cwd, config as Record<string, unknown>);
        for (const [label, peer] of [
          ['Speech (@zhin.js/speech)', peerDiagnosis.speech],
          ['HTML Renderer (@zhin.js/html-renderer)', peerDiagnosis.htmlRenderer],
        ] as const) {
          if (!peer?.required) continue;
          const missing = [...new Set([...peer.missingFromPackageJson, ...peer.notInstalled])];
          if (missing.length === 0) {
            results.push({
              name: label,
              status: 'ok',
              message: `已安装 (${peer.reason})`,
            });
            continue;
          }
          const fixCmd = formatOptionalPeerFixCommand(peer);
          results.push({
            name: label,
            status: 'warn',
            message: `需要 ${peer.packageName}（${peer.reason}），缺少: ${missing.join(', ')}`,
            fix: options.fix ? '将写入 package.json' : fixCmd,
          });
          if (options.fix && peer.missingFromPackageJson.length > 0) {
            await mergeDependenciesIntoPackageJson(cwd, {
              [peer.packageName]: 'latest',
            });
          }
        }
      } catch {
        results.push({
          name: 'Optional peer',
          status: 'warn',
          message: '无法读取配置以检查 speech / html-renderer',
        });
      }
    }

    // 6c. 适配器 endpoints 配置完整性（对照各适配器 schema.json 的 endpoints.items.required）
    if (existingConfig && !configParseFailed) {
      try {
        const config = (loadedConfig ?? await readConfig(path.join(cwd, existingConfig))) as Record<string, unknown>;
        const plugins = config.plugins;
        const issues: string[] = [];
        let checkedEndpoints = 0;
        if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
          for (const [key, confRaw] of Object.entries(plugins as Record<string, unknown>)) {
            if (!confRaw || typeof confRaw !== 'object' || Array.isArray(confRaw)) continue;
            const conf = confRaw as Record<string, unknown>;
            if (!Array.isArray(conf.endpoints) || conf.endpoints.length === 0) continue;
            const schema = loadPluginSchemaJson(cwd, key);
            if (!schema) continue;
            checkedEndpoints += conf.endpoints.length;
            for (const issue of findMissingEndpointFields(schema, conf)) {
              issues.push(`${key} endpoint「${issue.endpoint}」缺少 ${issue.missing.join(', ')}`);
            }
          }
        }
        if (issues.length > 0) {
          results.push({
            name: '适配器配置',
            status: 'error',
            message: issues.join('；'),
            fix: `补全 ${existingConfig} 中对应 endpoints 字段（如 QQ 的 appid/secret）后重跑 zhin doctor`,
          });
        } else {
          results.push({
            name: '适配器配置',
            status: 'ok',
            message: checkedEndpoints > 0 ? `${checkedEndpoints} 个 endpoint 必填字段完整` : '未声明带 endpoints 的适配器',
          });
        }
      } catch {
        results.push({
          name: '适配器配置',
          status: 'warn',
          message: '无法读取配置以检查适配器 endpoints',
        });
      }
    }

    // 7. 检查 node_modules
    const nodeModulesPath = path.join(cwd, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      results.push({
        name: '依赖安装',
        status: 'ok',
        message: 'node_modules 存在'
      });
    } else {
      results.push({
        name: '依赖安装',
        status: 'warn',
        message: 'node_modules 不存在',
        fix: 'pnpm install'
      });
    }

    // 8. 检查端口占用（读取已加载配置的 http.port，默认 8086）
    let httpPort = 8086;
    try {
      const configForPort: Record<string, unknown> | null = loadedConfig
        ?? (existingConfig ? await readConfig(path.join(cwd, existingConfig)) as Record<string, unknown> : null);
      const http = configForPort?.http;
      if (http && typeof http === 'object' && !Array.isArray(http)
        && typeof (http as Record<string, unknown>).port === 'number') {
        httpPort = (http as Record<string, unknown>).port as number;
      }
    } catch {
      // 配置不可读时使用默认端口
    }
    try {
      const { stdout } = await execAsync(`lsof -i:${httpPort} || (ss -lntp | grep :${httpPort}) 2>/dev/null`);
      if (stdout.trim()) {
        results.push({
          name: `端口 ${httpPort}`,
          status: 'warn',
          message: '已被占用',
          fix: `lsof -ti:${httpPort} | xargs kill -9，或在 zhin.config.yml 修改 http.port 换用其他端口`
        });
      } else {
        results.push({
          name: `端口 ${httpPort}`,
          status: 'ok',
          message: '可用'
        });
      }
    } catch {
      results.push({
        name: `端口 ${httpPort}`,
        status: 'ok',
        message: '可用'
      });
    }

    // 9. 检查 TypeScript
    if (fs.existsSync(path.join(cwd, 'tsconfig.json'))) {
      try {
        const { stdout } = await execAsync('tsc --version');
        results.push({
          name: 'TypeScript',
          status: 'ok',
          message: stdout.trim()
        });
      } catch {
        results.push({
          name: 'TypeScript',
          status: 'warn',
          message: '未安装',
          fix: 'pnpm add -D typescript'
        });
      }
    }

    // 10. 检查环境变量文件
    const envFile = path.join(cwd, '.env');
    if (fs.existsSync(envFile)) {
      results.push({
        name: '环境变量',
        status: 'ok',
        message: '.env 文件存在'
      });
    } else {
      results.push({
        name: '环境变量',
        status: 'warn',
        message: '.env 文件不存在',
        fix: options.fix ? '将创建空的 .env 文件' : '手动创建 .env 文件'
      });
      
      if (options.fix) {
        await fs.writeFile(envFile, '# Zhin.js 环境变量\nHTTP_TOKEN=zhin-local-token\n');
        logger.info(formatCompact( { cmd: 'doctor', op: 'create_env', file: '.env' }));
      }
    }

    // 10b. 检查 HTTP_TOKEN 是否设置（http.token / Console 登录鉴权依赖它）
    const envContent = fs.existsSync(envFile) ? await fs.readFile(envFile, 'utf-8') : '';
    const httpTokenSet = Boolean(process.env.HTTP_TOKEN) || /^\s*HTTP_TOKEN\s*=\s*\S+/m.test(envContent);
    results.push({
      name: 'HTTP_TOKEN',
      status: httpTokenSet ? 'ok' : 'warn',
      message: httpTokenSet ? '已设置' : '未设置（http.token 引用 ${HTTP_TOKEN} 时 Console/API 无法鉴权）',
      fix: httpTokenSet ? undefined : '在 .env 添加 HTTP_TOKEN=<随机串>，或 export HTTP_TOKEN=<随机串>'
    });

    // 打印结果
    console.log('');
    let hasErrors = false;
    let hasWarnings = false;

    for (const result of results) {
      const icon = result.status === 'ok' ? '✅' : result.status === 'warn' ? '⚠️' : '❌';
      const color = result.status === 'ok' ? chalk.green : result.status === 'warn' ? chalk.yellow : chalk.red;
      
      console.log(`${icon} ${chalk.bold(result.name)}: ${color(result.message)}`);
      
      if (result.fix && !options.fix) {
        console.log(`   ${chalk.gray('修复:')} ${chalk.cyan(result.fix)}`);
      }
      
      if (result.status === 'error') hasErrors = true;
      if (result.status === 'warn') hasWarnings = true;
    }

    console.log('');
    
    if (hasErrors) {
      console.log(chalk.red('❌ 发现严重问题，请修复后再运行'));
      process.exit(1);
    } else if (hasWarnings) {
      console.log(chalk.yellow('⚠️  发现警告，建议修复以获得最佳体验'));
      if (!options.fix) {
        console.log(chalk.gray('提示: 运行 ') + chalk.cyan('zhin doctor --fix') + chalk.gray(' 自动修复可修复的问题'));
      }
    } else {
      console.log(chalk.green('✅ 所有检查通过！'));
    }
  });

/** 从 YAML/JSON 解析错误中提取行号（yaml 的 YAMLParseError 带 linePos，其余从 message 正则兜底） */
function extractConfigErrorLine(err: unknown): number | null {
  const linePos = (err as { linePos?: Array<{ line: number }> } | null)?.linePos;
  if (Array.isArray(linePos) && linePos[0]?.line) return linePos[0].line;
  const message = err instanceof Error ? err.message : String(err);
  const match = /line (\d+)/i.exec(message) ?? /at line (\d+)/i.exec(message);
  return match ? parseInt(match[1], 10) : null;
}

export async function createDefaultConfig(cwd: string): Promise<void> {
  // 新 Plugin Runtime 形态：plugins 为 instanceKey → 配置 映射；
  // Console Host 由 CLI composition root 装配，无需 host-router/host-api 插件
  const configContent = `plugins:
  sandbox: {}
http:
  token: \${HTTP_TOKEN}
  corsOrigins:
    - "${CONSOLE_URL}"
`;
  await fs.writeFile(path.join(cwd, 'zhin.config.yml'), configContent);
}

async function createMissingBootstrapFiles(cwd: string, files: string[]): Promise<void> {
  const templates: Record<string, string> = {
    'SOUL.md': `# Soul\n\n我是一个能力出众、行动导向的 AI 助手。\n`,
    'TOOLS.md': `# Tools Guide\n\n## 工具使用原则\n\n- 低风险操作：直接调用\n- 高风险操作：简要说明理由\n`,
    'AGENTS.md': `# Agent Memory\n\n这是一个长期记忆文件，用于记录重要信息。\n`
  };
  
  for (const file of files) {
    if (templates[file]) {
      await fs.writeFile(path.join(cwd, file), templates[file]);
    }
  }
}
