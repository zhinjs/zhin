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
import { defaultInstanceLogFile, isSupervisedInstanceProcess } from '@zhin.js/gateway/supervisor';
import { formatStartOptionHelp, parseStartOptions } from '@zhin.js/runtime';
import { readChatOwnerClaim, renderChatOwnerClaim } from '../utils/chat-owner-claim.js';
import {
  consoleSetupToken,
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
import { serviceStopAdviceFor } from '../utils/service-definition.js';
import { formatGatewayVersionSkew, gatewayVersionSkew, installedGatewayVersion } from '../utils/gateway-version.js';
import { readRuntimeState, renderRuntimeState, runtimeStateUnavailable } from '../utils/runtime-state.js';
import {
  hasLogFilter,
  instanceLogFiles,
  LogLineFilter,
  parseLogFilterLevel,
  parseLogTime,
  readFilteredHistory,
  type LogFilterOptions,
} from '../utils/log-filter.js';
import { previewUpdate, renderUpdatePreview } from '../utils/update-preview.js';
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

/** The bootstrap token for the Console link of a running gateway (its own start options pick the environment). */
function setupTokenFor(root: string, status: LocalGatewayInfoResult, environment?: string): Promise<string | undefined> {
  let name = environment;
  if (name === undefined) {
    try { name = parseStartOptions(status.gateway.args).environment; } catch { name = 'development'; }
  }
  return consoleSetupToken(root, status, name);
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
        const setupToken = await setupTokenFor(root, running);
        process.stdout.write(`网关已在运行。\n${renderStatus(running, Date.now(), { setupToken }).join('\n')}\n`);
        return;
      }
      const started = await startGatewayDaemon({ root, args: rest });
      const setupToken = await setupTokenFor(root, started.status, parsed.environment);
      process.stdout.write(`✓ 网关已在后台启动（pid ${started.pid}）\n${renderStatus(started.status, Date.now(), { setupToken }).join('\n')}\n`);
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
      // ADR 0062 §2: a gateway run by a system service (zhin service install).
      const advice = await serviceStopAdviceFor(root, running);
      if (advice.refuse) {
        process.stderr.write(`zhin: ${advice.lines.join('\n')}\n`);
        process.exitCode = 1;
        return;
      }
      await withGateway({ root }, (client) => client.request(LOCAL_GATEWAY_RPC.SHUTDOWN, undefined, { timeoutMs: 10_000 }));
      process.stdout.write(`正在停止网关（pid ${running.gateway.pid}）…\n`);
      if (!await waitForGatewayExit({ root }, running.gateway.pid, Number(options.timeout) || 60_000)) {
        throw new Error(`网关 ${running.gateway.pid} 在超时内没有退出`);
      }
      process.stdout.write('✓ 网关与实例已停止\n');
      for (const line of advice.lines) process.stdout.write(`${line}\n`);
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
      const setupToken = await setupTokenFor(root, started.status);
      process.stdout.write(`✓ 网关已重启（pid ${started.pid}）\n${renderStatus(started.status, Date.now(), { setupToken }).join('\n')}\n`);
    } catch (error) { fail(error); }
  });

export const statusCommand = new Command('status')
  .description('查看网关、实例、适配器账号、MCP 服务与待处理事项（网关未运行时退出码为 3）')
  .option('--json', '以 JSON 输出（含 endpoints、mcp、attention；读取失败的项为 { available: false, error }）')
  .addHelpText('after', '\nExit codes:\n  0  网关正在运行（实例与运行状态见输出；读不到的运行状态显示「无法读取」）\n  1  查询失败\n  3  网关未运行（LSB「program is not running」）')
  .action(async (options: { json?: boolean }) => {
    const { root } = target();
    try {
      const running = await probeGateway({ root });
      // ADR 0060 §3.3: the claim code of the running instance (only while there is no chat owner).
      const claim = running?.instance.state === 'running' ? await readChatOwnerClaim(root, running.instance) : undefined;
      // #1250: accounts, MCP servers and the attention inbox over the local socket, each with a deadline.
      const runtime = running
        ? running.instance.state === 'running' ? await readRuntimeState(root) : runtimeStateUnavailable('实例未运行')
        : undefined;
      const installedVersion = running ? installedGatewayVersion(root) : undefined;
      const skew = running ? gatewayVersionSkew(running.gateway, installedVersion) : undefined;
      if (options.json) {
        process.stdout.write(`${JSON.stringify(running
          ? { gateway: { running: true, ...running.gateway, ...(installedVersion ? { installedVersion } : {}), ...(skew ? { versionSkew: skew } : {}) },
            instance: running.instance, consoleInitialized: running.consoleInitialized,
            ...(claim ? { chatOwnerClaim: { code: claim.code, createdAt: claim.createdAt } } : {}),
            endpoints: runtime!.endpoints, mcp: runtime!.mcp, attention: runtime!.attention }
          : { gateway: { running: false }, instance: null }, null, 2)}\n`);
      } else if (running) {
        const setupToken = await setupTokenFor(root, running);
        process.stdout.write(`${[
          ...renderStatus(running, Date.now(), { setupToken }),
          ...(skew ? formatGatewayVersionSkew(skew) : []),
          ...renderRuntimeState(runtime!),
          ...(claim ? renderChatOwnerClaim(claim) : []),
        ].join('\n')}\n`);
      } else {
        process.stdout.write('网关：未运行（zhin start 启动）\n');
      }
      if (!running) process.exitCode = STATUS_NOT_RUNNING_EXIT_CODE;
    } catch (error) { fail(error); }
  });

/** `-n` without filters reads the gateway's 1000-line buffer; with filters it searches the log files. */
const MAX_LINES = 1000;
const MAX_FILTERED_LINES = 100_000;
const DEFAULT_LINES = 200;

function parseLineCount(value: string | undefined, max: number): number {
  if (value === undefined) return DEFAULT_LINES;
  const lines = Number(value);
  if (!Number.isInteger(lines) || lines < 1 || lines > max) throw new Error(`-n 必须是 1–${max} 的整数`);
  return lines;
}

const sleep = (ms: number): Promise<void> => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** Follows a log file by polling its size (no gateway). */
async function followFile(file: string, output: Output, pollMs: number, filter?: LogLineFilter): Promise<never> {
  let offset = existsSync(file) ? statSync(file).size : 0;
  let pending = '';
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
      offset = size;
      if (!filter) { output.out(buffer.toString('utf8')); continue; }
      const lines = (pending + buffer.toString('utf8')).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) for (const shown of filter.take(line)) output.out(`${shown}\n`);
    } finally { await handle.close(); }
  }
}

interface LogsOptions {
  follow?: boolean;
  lines?: string;
  interval: string;
  level?: string;
  since?: string;
  until?: string;
  grep?: string;
  name?: string;
}

/** `zhin logs` filter options (#1250); undefined when none is given. */
export function logFilterOptions(options: LogsOptions, now = new Date()): LogFilterOptions | undefined {
  const filter: LogFilterOptions = {
    ...(options.level !== undefined ? { level: parseLogFilterLevel(options.level) } : {}),
    ...(options.since !== undefined ? { since: parseLogTime(options.since, '--since', now) } : {}),
    ...(options.until !== undefined ? { until: parseLogTime(options.until, '--until', now) } : {}),
    ...(options.grep !== undefined && options.grep !== '' ? { grep: options.grep } : {}),
    ...(options.name !== undefined && options.name.trim() !== '' ? { name: options.name.trim() } : {}),
  };
  if (filter.since && filter.until && filter.since.getTime() > filter.until.getTime()) throw new Error('--since 晚于 --until');
  return hasLogFilter(filter) ? filter : undefined;
}

export const logsCommand = new Command('logs')
  .description('查看实例日志（网关运行时经 gateway.instance.logs；否则读取 .zhin/logs/instance.log）；带过滤条件时搜索全部日志文件')
  .option('-f, --follow', '持续输出新日志（与过滤条件同用时只输出匹配的行）')
  .option('-n, --lines <n>', `显示最近 N 行（默认 ${DEFAULT_LINES}；1–${MAX_LINES}，带过滤条件时为匹配的行，最多 ${MAX_FILTERED_LINES}）`)
  .option('--level <level>', '只看该级别及以上：debug / info / warn / error')
  .option('--since <time>', '只看此时间之后：10m / 1h / 2d、09:00、2026-11-15 09:00 或带时区的 ISO 时间')
  .option('--until <time>', '只看此时间之前（写法同 --since）')
  .option('--grep <text>', '只看包含该文字的行（不区分大小写）')
  .option('--name <logger>', '只看该日志来源，即行首的 [名称] 段（icqq 也匹配 icqq:12345）')
  .option('--interval <ms>', '-f 的轮询间隔', '1000')
  .addHelpText('after', [
    '',
    '过滤说明：',
    '  日志行的格式是 [日期 时间][级别] [名称] 内容；堆栈等续行跟随它上面的那一条。',
    '  日志不记录插件名，按来源过滤用 --name（行首的 [名称]）。',
    '  日志行不带时区偏移：行里的时间与不带时区的 --since / --until 都按本机时区解释。',
    '  升级前写入的行只有时间、没有日期，--since / --until 会跳过它们；--grep 命中续行时先输出它所属的日志行。',
    '  带过滤条件时依次读取实例日志文件（默认 .zhin/logs/instance.log）及轮转文件 .1、.2…（不受 1000 行缓冲限制）。',
  ].join('\n'))
  .action(async (options: LogsOptions) => {
    const { root } = target();
    const output = processOutput;
    try {
      const filterOptions = logFilterOptions(options);
      const lines = parseLineCount(options.lines, filterOptions ? MAX_FILTERED_LINES : MAX_LINES);
      const pollMs = Math.max(100, Number(options.interval) || 1000);
      const running = await probeGateway({ root });
      // The running gateway names its log file (`--log-file`); otherwise the default location.
      const file = running?.gateway.logFile ?? defaultInstanceLogFile(root);
      const filter = filterOptions ? new LogLineFilter(filterOptions) : undefined;
      const files = instanceLogFiles(file);
      const reportFiltered = (matched: number, shown: number): void => {
        if (matched > shown) process.stderr.write(`（共 ${matched} 行匹配，只显示最后 ${shown} 行；用 -n 调整）\n`);
        if (matched === 0) process.stderr.write('（没有匹配的日志）\n');
        if (filter!.undatedSkipped > 0) process.stderr.write(`（${filter!.undatedSkipped} 条日志没有日期（升级前写入），--since / --until 跳过了它们）\n`);
      };
      if (!running) {
        if (!existsSync(file)) {
          process.stderr.write(`网关未运行，也没有日志文件 ${file}\n`);
          process.exitCode = 1;
          return;
        }
        process.stderr.write(`（网关未运行，读取 ${file}）\n`);
        if (filter) {
          const history = await readFilteredHistory(files, filter, lines);
          for (const line of history.lines) output.out(`${line}\n`);
          reportFiltered(history.matched, history.lines.length);
        } else {
          for (const line of readFileTail(file, lines)) output.out(`${line}\n`);
        }
        if (options.follow) await followFile(file, output, pollMs, filter);
        return;
      }
      await withGateway({ root }, async (client) => {
        const read = (count: number) => client.request<GatewayInstanceLogs>(GATEWAY_RPC.LOGS, { lines: count }, { timeoutMs: 10_000 });
        let last = 0;
        const print = (logs: GatewayInstanceLogs): void => {
          for (const line of logs.lines) {
            if (line.seq <= last) continue;
            last = line.seq;
            const write = line.stream === 'stderr' ? output.err : output.out;
            for (const shown of filter ? filter.take(line.line, line.time) : [line.line]) write(`${shown}\n`);
          }
        };
        if (filter && files.length > 0) {
          // History from the files; following continues after the newest buffered line.
          last = (await read(1)).lines.at(-1)?.seq ?? 0;
          const history = await readFilteredHistory(files, filter, lines);
          for (const line of history.lines) output.out(`${line}\n`);
          reportFiltered(history.matched, history.lines.length);
        } else if (filter) {
          // No log file (custom location): filter the gateway's buffer, using its capture times.
          const kept: { stream: 'stdout' | 'stderr'; text: string }[] = [];
          let matched = 0;
          for (const line of (await read(MAX_LINES)).lines) {
            last = line.seq;
            for (const text of filter.take(line.line, line.time)) {
              matched += 1;
              kept.push({ stream: line.stream, text });
            }
          }
          for (const line of kept.slice(-lines)) (line.stream === 'stderr' ? output.err : output.out)(`${line.text}\n`);
          reportFiltered(matched, Math.min(matched, lines));
        } else {
          print(await read(lines));
        }
        if (!options.follow) return;
        for (;;) {
          await sleep(pollMs);
          print(await read(MAX_LINES));
        }
      });
    } catch (error) { fail(error); }
  });

export const updateCommand = new Command('update')
  .description('更新依赖（网关运行时经网关：停实例 → 包管理器 → 启实例，失败回滚）')
  .argument('[packages...]', '包名，或 name@精确版本；省略时更新全部依赖')
  .option('--dry-run', '只列出会升级的包与版本（Zhin 包在前，含 pnpm 工作区成员）及 pnpm overrides 的同步，不写任何文件，也不停止或重启实例')
  .action(async (packages: string[], options: { dryRun?: boolean }) => {
    const { root } = target();
    if (options.dryRun) {
      try {
        const running = await probeGateway({ root }).catch(() => undefined);
        for (const line of renderUpdatePreview(await previewUpdate(root, packages), running?.instance.state === 'running')) process.stdout.write(`${line}\n`);
      } catch (error) { fail(error); }
      return;
    }
    const request = { operation: 'update' as const, packages: packages.length ? packages : 'all' as const };
    try {
      const running = await probeGateway({ root });
      const before = installedGatewayVersion(root);
      const result = running
        ? await runPackageOperationViaGateway({ root }, request)
        : await runPackageOperationDirect({ root }, request);
      if (!result.ok) process.exitCode = 1;
      for (const line of updateGatewayNotice(running?.gateway, before, installedGatewayVersion(root))) process.stdout.write(`${line}\n`);
    } catch (error) { fail(error); }
  });

/**
 * What `zhin update` says about the gateway afterwards (#1250): the update replaced
 * `@zhin.js/gateway` but the running gateway keeps its old code until it is restarted. Without a
 * running gateway the next `zhin start` simply loads the new version.
 */
export function updateGatewayNotice(
  gateway: Readonly<{ pid: number; mode: 'foreground' | 'daemon'; version: string }> | undefined,
  before: string | undefined,
  after: string | undefined,
): string[] {
  if (!after || before === after) {
    // Unchanged package; a gateway already behind the installed one still needs the restart.
    const skew = gateway ? gatewayVersionSkew(gateway, after) : undefined;
    return skew ? formatGatewayVersionSkew(skew) : [];
  }
  if (!gateway) return [`@zhin.js/gateway：${before ?? '未安装'} → ${after}；下次 zhin start 会使用新版本`];
  const skew = gatewayVersionSkew(gateway, after);
  return skew ? [`@zhin.js/gateway：${before ?? '未安装'} → ${after}`, ...formatGatewayVersionSkew(skew)] : [];
}
