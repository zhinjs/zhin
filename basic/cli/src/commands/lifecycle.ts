/**
 * Gateway lifecycle commands (ADR 0054 §6): `zhin start / stop / restart / status / logs /
 * update`. With a running gateway they talk to it over the local control socket
 * (`.zhin/gateway.sock`); without one, `stop` / `restart` have nothing to do, `status` reports
 * "not running" (exit 3), `logs` reads the log file and `update` runs the transaction directly.
 */
import { existsSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import type { GatewayInstanceLogs, GatewayInstanceStatus } from '@zhin.js/console-protocol';
import { GATEWAY_RPC } from '@zhin.js/console-protocol';
import { LOCAL_GATEWAY_RPC, type LocalGatewayInfoResult } from '@zhin.js/gateway/local';
import { consoleLink, loadGatewayHttpConfig } from '@zhin.js/gateway/server';
import { defaultInstanceLogFile, isSupervisedInstanceProcess } from '@zhin.js/gateway/supervisor';
import { formatStartOptionHelp, parseStartOptions } from '@zhin.js/runtime';
import {
  describeGatewayError,
  describeInstance,
  probeGateway,
  processOutput,
  readFileTail,
  renderStatus,
  runPackageOperationDirect,
  runPackageOperationViaGateway,
  startGatewayDaemon,
  waitForGatewayExit,
  withGateway,
  type GatewayTarget,
  type Output,
} from '../utils/gateway.js';
import { getProcessStatus, stopProcess } from '../utils/process.js';
import { describeForegroundGatewayRestart, detectProcessManager, readProcessContext } from '../utils/process-manager.js';
import { runtimeCommand } from './runtime.js';

/**
 * `zhin status` exit code when no gateway runs (LSB "program is not running"; scripts and
 * service health checks test for 3). Other failures exit 1.
 */
export const STATUS_NOT_RUNNING_EXIT_CODE = 3;

const target = (): GatewayTarget => ({ root: resolve(process.cwd()) });

function fail(error: unknown): void {
  process.stderr.write(`zhin: ${describeGatewayError(error)}\n`);
  process.exitCode = 1;
}

/** Splits `zhin start` arguments into CLI-only flags and the instance start options. */
export function splitStartArguments(args: readonly string[]): { readonly foreground: boolean; readonly rest: readonly string[] } {
  let foreground = false;
  const rest: string[] = [];
  for (const argument of args) {
    if (argument === '--foreground' || argument === '-f') foreground = true;
    else if (argument === '--daemon' || argument === '-d') continue;
    else rest.push(argument);
  }
  // `--once` (CI check) and `--standalone` (no gateway) always run attached.
  if (rest.includes('--once') || rest.includes('--standalone')) foreground = true;
  return { foreground, rest };
}

async function printConsoleHint(root: string, status: LocalGatewayInfoResult, environment: string, output: Output): Promise<void> {
  const origin = status.gateway.origins[0];
  if (!origin || status.consoleInitialized || process.stdout.isTTY !== true) return;
  // ADR 0053 §1: the bootstrap token goes after `#`, and only to an interactive terminal.
  const token = await loadGatewayHttpConfig(root, environment).then((config) => config.token, () => undefined);
  if (token) output.out(`  初始化 Console：${consoleLink(origin, token)}\n`);
}

export const startCommand = new Command('start')
  .description('启动管理网关与 Zhin 实例（默认后台运行；--foreground 前台运行，Ctrl+C 同时停止两者）')
  .usage('[--foreground] [options]')
  .addHelpText('after', [
    '',
    'Gateway options:',
    '  -f, --foreground  前台运行（开发、systemd、容器、PM2）；默认后台运行并写 .zhin/logs/gateway.log',
    '  -d, --daemon      后台运行（默认，可省略）',
    formatStartOptionHelp('zhin start'),
  ].join('\n'))
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(async (_options, command: Command) => {
    const { foreground, rest } = splitStartArguments(command.args);
    if (foreground || isSupervisedInstanceProcess()) {
      await runtimeCommand.parseAsync(['start', ...rest], { from: 'user' });
      return;
    }
    const { root } = target();
    try {
      const parsed = parseStartOptions(rest);
      const running = await probeGateway({ root });
      if (running) {
        process.stdout.write(`网关已在运行。\n${renderStatus(running).join('\n')}\n`);
        return;
      }
      const started = await startGatewayDaemon({ root, args: rest });
      process.stdout.write(`✓ 网关已在后台启动（pid ${started.pid}）\n${renderStatus(started.status).join('\n')}\n`);
      await printConsoleHint(root, started.status, parsed.environment, processOutput);
      process.stdout.write(`日志：zhin logs -f（网关自身输出：${started.logFile}）；停止：zhin stop\n`);
    } catch (error) { fail(error); }
  });

export const stopCommand = new Command('stop')
  .description('停止网关与实例（经本地控制套接字）')
  .option('--timeout <ms>', '等待网关退出的时间', '60000')
  .action(async (options: { timeout: string }) => {
    const { root } = target();
    try {
      const running = await probeGateway({ root });
      if (!running) {
        // A pre-gateway supervisor (no control socket) still has its pid file.
        const legacy = await getProcessStatus(root);
        if (legacy.running) {
          process.stdout.write(`未找到网关控制套接字；按 .zhin.pid 停止进程 ${legacy.pid}\n`);
          await stopProcess(root);
          return;
        }
        process.stdout.write('网关未运行，无需停止。\n');
        return;
      }
      await withGateway({ root }, (client) => client.request(LOCAL_GATEWAY_RPC.SHUTDOWN, undefined, { timeoutMs: 10_000 }));
      process.stdout.write(`正在停止网关（pid ${running.gateway.pid}）…\n`);
      if (!await waitForGatewayExit({ root }, running.gateway.pid, Number(options.timeout) || 60_000)) {
        throw new Error(`网关 ${running.gateway.pid} 在超时内没有退出`);
      }
      process.stdout.write('✓ 网关与实例已停止\n');
    } catch (error) { fail(error); }
  });

export const restartCommand = new Command('restart')
  .description('重启实例（网关保持运行）；--gateway 重启网关本身')
  .option('--gateway', '重启网关进程（仅后台网关，沿用原启动参数；前台网关会提示 systemd / PM2 等替代命令并以非 0 退出）')
  .action(async (options: { gateway?: boolean }) => {
    const { root } = target();
    try {
      const running = await probeGateway({ root });
      if (!running) {
        process.stdout.write('网关未运行，无需重启；用 zhin start 启动。\n');
        return;
      }
      if (!options.gateway) {
        const status = await withGateway({ root }, (client) => client.request<GatewayInstanceStatus>(GATEWAY_RPC.RESTART));
        process.stdout.write(`✓ 实例已重启：${describeInstance(status)}\n`);
        return;
      }
      if (running.gateway.mode !== 'daemon') {
        // No in-place re-exec of a foreground gateway: name the command that restarts it (#1250).
        const manager = detectProcessManager(readProcessContext(running.gateway.pid));
        process.stderr.write(`zhin: ${describeForegroundGatewayRestart(running.gateway.pid, running.gateway.args, manager)}\n`);
        process.exitCode = 1;
        return;
      }
      await withGateway({ root }, (client) => client.request(LOCAL_GATEWAY_RPC.SHUTDOWN, undefined, { timeoutMs: 10_000 }));
      if (!await waitForGatewayExit({ root }, running.gateway.pid)) throw new Error(`网关 ${running.gateway.pid} 在超时内没有退出`);
      const started = await startGatewayDaemon({ root, args: running.gateway.args });
      process.stdout.write(`✓ 网关已重启（pid ${started.pid}）\n${renderStatus(started.status).join('\n')}\n`);
    } catch (error) { fail(error); }
  });

export const statusCommand = new Command('status')
  .description('查看网关与实例状态（网关未运行时退出码为 3）')
  .option('--json', '以 JSON 输出')
  .addHelpText('after', '\nExit codes:\n  0  网关正在运行（实例状态见输出）\n  1  查询失败\n  3  网关未运行（LSB「program is not running」）')
  .action(async (options: { json?: boolean }) => {
    const { root } = target();
    try {
      const running = await probeGateway({ root });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(running
          ? { gateway: { running: true, ...running.gateway }, instance: running.instance, consoleInitialized: running.consoleInitialized }
          : { gateway: { running: false }, instance: null }, null, 2)}\n`);
      } else if (running) {
        process.stdout.write(`${renderStatus(running).join('\n')}\n`);
      } else {
        process.stdout.write('网关：未运行（zhin start 启动）\n');
      }
      if (!running) process.exitCode = STATUS_NOT_RUNNING_EXIT_CODE;
    } catch (error) { fail(error); }
  });

function parseLineCount(value: string): number {
  const lines = Number(value);
  if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new Error('-n 必须是 1–1000 的整数');
  return lines;
}

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** Follows a log file by polling its size (no gateway). */
async function followFile(file: string, output: Output, pollMs: number): Promise<never> {
  let offset = existsSync(file) ? statSync(file).size : 0;
  for (;;) {
    await sleep(pollMs);
    let size = 0;
    try { size = statSync(file).size; } catch { continue; }
    if (size < offset) offset = 0; // rotated
    if (size === offset) continue;
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(size - offset);
      await handle.read(buffer, 0, buffer.length, offset);
      output.out(buffer.toString('utf8'));
      offset = size;
    } finally { await handle.close(); }
  }
}

export const logsCommand = new Command('logs')
  .description('查看实例日志（网关运行时经 gateway.instance.logs；否则读取 .zhin/logs/instance.log）')
  .option('-f, --follow', '持续输出新日志')
  .option('-n, --lines <n>', '显示最近 N 行（1–1000）', '200')
  .option('--interval <ms>', '-f 的轮询间隔', '1000')
  .action(async (options: { follow?: boolean; lines: string; interval: string }) => {
    const { root } = target();
    const output = processOutput;
    try {
      const lines = parseLineCount(options.lines);
      const pollMs = Math.max(100, Number(options.interval) || 1000);
      const running = await probeGateway({ root });
      if (!running) {
        const file = defaultInstanceLogFile(root);
        if (!existsSync(file)) {
          process.stderr.write(`网关未运行，也没有日志文件 ${file}\n`);
          process.exitCode = 1;
          return;
        }
        process.stderr.write(`（网关未运行，读取 ${file}）\n`);
        for (const line of readFileTail(file, lines)) output.out(`${line}\n`);
        if (options.follow) await followFile(file, output, pollMs);
        return;
      }
      await withGateway({ root }, async (client) => {
        const read = (count: number) => client.request<GatewayInstanceLogs>(GATEWAY_RPC.LOGS, { lines: count }, { timeoutMs: 10_000 });
        let last = 0;
        const print = (logs: GatewayInstanceLogs): void => {
          for (const line of logs.lines) {
            if (line.seq <= last) continue;
            last = line.seq;
            (line.stream === 'stderr' ? output.err : output.out)(`${line.line}\n`);
          }
        };
        print(await read(lines));
        if (!options.follow) return;
        for (;;) {
          await sleep(pollMs);
          print(await read(1000));
        }
      });
    } catch (error) { fail(error); }
  });

export const updateCommand = new Command('update')
  .description('更新依赖（网关运行时经网关：停实例 → 包管理器 → 启实例，失败回滚）')
  .argument('[packages...]', '包名，或 name@精确版本；省略时更新全部依赖')
  .action(async (packages: string[]) => {
    const { root } = target();
    const request = { operation: 'update' as const, packages: packages.length ? packages : 'all' as const };
    try {
      const running = await probeGateway({ root });
      const result = running
        ? await runPackageOperationViaGateway({ root }, request)
        : await runPackageOperationDirect({ root }, request);
      if (!result.ok) process.exitCode = 1;
    } catch (error) { fail(error); }
  });
