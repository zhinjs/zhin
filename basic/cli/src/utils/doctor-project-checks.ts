/**
 * Two `zhin doctor` checks (#1250):
 * - service files an older scaffold left in the project root (ADR 0062 §2: `zhin service install`
 *   now writes the unit for the current system itself); only reported, never deleted;
 * - who holds the HTTP port when it is not this project's gateway: a `GET /pub/health` probe
 *   (no credentials) tells a Zhin gateway from anything else, and its `project.id` — compared
 *   with the projects of the listening processes — names the project.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectIdentity } from '@zhin.js/gateway/project';

const execFileAsync = promisify(execFile);

const SERVICE_FILE_PATTERNS: readonly RegExp[] = [
  /\.service$/u,
  /\.plist$/u,
  /^install-service\.ps1$/u,
  /-task\.xml$/u,
];
const PM2_FILE = /^ecosystem\.config\.(?:c?js|mjs|json|ya?ml)$/u;

export interface LegacyServiceFiles {
  /** systemd / launchd / Windows service files. */
  readonly service: readonly string[];
  /** PM2 `ecosystem.config.*` (still in use when the project is run with PM2). */
  readonly pm2: readonly string[];
}

/** Service files in the project root that mention Zhin (sorted names). */
export function findLegacyServiceFiles(root: string): LegacyServiceFiles {
  let names: string[];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name); }
  catch { return { service: [], pm2: [] }; }
  const mentionsZhin = (name: string): boolean => {
    try {
      const file = path.join(root, name);
      if (fs.statSync(file).size > 1024 * 1024) return false;
      return /zhin/iu.test(fs.readFileSync(file, 'utf8'));
    } catch { return false; }
  };
  return {
    service: names.filter(name => SERVICE_FILE_PATTERNS.some(pattern => pattern.test(name)) && mentionsZhin(name)).sort(),
    pm2: names.filter(name => PM2_FILE.test(name) && mentionsZhin(name)).sort(),
  };
}

export interface DoctorCheck {
  readonly status: 'ok' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fix?: string;
}

/** The doctor result for {@link findLegacyServiceFiles}; undefined when there is nothing to say. */
export function legacyServiceFilesCheck(files: LegacyServiceFiles): DoctorCheck | undefined {
  if (!files.service.length && !files.pm2.length) return undefined;
  const parts: string[] = [];
  if (files.service.length) {
    parts.push(`项目根目录里有旧版脚手架生成的服务文件：${files.service.join('、')}。现在由 zhin service install 按当前系统现场生成并安装，这些文件不再使用，可以删除`);
  }
  if (files.pm2.length) parts.push(`${files.pm2.join('、')} 只在用 PM2 托管时需要；不用 PM2 可以删除`);
  return {
    status: 'info',
    message: `${parts.join('；')}（doctor 不会删除）`,
    fix: '确认不再使用后手动删除；托管与开机自启用 zhin service install',
  };
}

/** What `/pub/health` on the port says (no credentials are sent). */
export type PortHealth =
  | { readonly kind: 'zhin-gateway'; readonly projectId?: string }
  | { readonly kind: 'zhin-instance' }
  | { readonly kind: 'other' };

/** `GET <origin>/pub/health` with a short deadline; never sends a token or cookie. */
export async function probePortHealth(origin: string, fetchImpl: typeof fetch = fetch): Promise<PortHealth> {
  try {
    const response = await fetchImpl(`${origin}/pub/health`, { signal: AbortSignal.timeout(2_000), redirect: 'error', credentials: 'omit' });
    const body = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
    if (!body || body.success !== true || body.status !== 'ok' || typeof body.timestamp !== 'string') return { kind: 'other' };
    const instance = body.instance as { state?: unknown } | undefined;
    if (!instance || typeof instance.state !== 'string') return { kind: 'zhin-instance' };
    const projectId = (body.project as { id?: unknown } | undefined)?.id;
    return { kind: 'zhin-gateway', ...(typeof projectId === 'string' ? { projectId } : {}) };
  } catch {
    return { kind: 'other' };
  }
}

/** pids listening on a TCP port (lsof); empty when unknown. */
export async function listeningPids(port: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { timeout: 5_000 });
    return [...new Set(stdout.split(/\s+/u).map(Number).filter(pid => Number.isInteger(pid) && pid > 0))];
  } catch {
    return [];
  }
}

/** Working directory of a process (Linux /proc, else lsof); undefined when unknown. */
export async function processCwd(pid: number): Promise<string | undefined> {
  try { return fs.readlinkSync(`/proc/${pid}/cwd`); } catch { /* not Linux, or not ours */ }
  try {
    const { stdout } = await execFileAsync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 5_000 });
    const line = stdout.split('\n').find(entry => entry.startsWith('n'));
    return line ? line.slice(1) : undefined;
  } catch {
    return undefined;
  }
}

export interface PortOwnerOptions {
  readonly fetch?: typeof fetch;
  readonly pids?: (port: number) => Promise<number[]>;
  readonly cwdOf?: (pid: number) => Promise<string | undefined>;
}

/**
 * The doctor result for a port that is taken but not by this project's running gateway (as seen
 * over its control socket).
 */
export async function describePortOwner(port: number, projectRoot: string, options: PortOwnerOptions & { readonly tls?: boolean } = {}): Promise<DoctorCheck> {
  const health = await probePortHealth(`${options.tls ? 'https' : 'http'}://127.0.0.1:${port}`, options.fetch);
  const stop = `或在 zhin.config.yml 修改 http.port 换用其他端口`;
  if (health.kind === 'other') {
    return {
      status: 'warn',
      message: '已被占用（不是 Zhin 网关：/pub/health 没有应答）',
      fix: `用 lsof -i:${port} 找到进程后 kill <pid>（SIGTERM），${stop}`,
    };
  }
  if (health.kind === 'zhin-instance') {
    return {
      status: 'warn',
      message: '已被一个 Zhin 实例占用（不经网关运行，例如 --standalone 或旧版）',
      fix: `在它的终端按 Ctrl+C 停止，${stop}`,
    };
  }
  if (health.projectId === undefined) {
    return {
      status: 'warn',
      message: '已被一个 Zhin 网关占用（旧版，未报告项目标识，无法确认是哪个项目）',
      fix: `到那个项目目录运行 zhin stop，${stop}`,
    };
  }
  if (health.projectId === projectIdentity(projectRoot)) {
    return {
      status: 'warn',
      message: '已被本项目的另一个网关占用，但本地控制套接字不可用（可能由其他用户启动，或 .zhin/gateway.sock 被删除）',
      fix: `用 lsof -i:${port} 找到网关进程后 kill <pid>（SIGTERM），再用 zhin start 启动`,
    };
  }
  for (const pid of await (options.pids ?? listeningPids)(port)) {
    const cwd = await (options.cwdOf ?? processCwd)(pid);
    if (cwd && projectIdentity(cwd) === health.projectId) {
      return {
        status: 'warn',
        message: `已被另一个项目的 Zhin 网关占用：${cwd}（pid ${pid}）`,
        fix: `在 ${cwd} 运行 zhin stop，${stop}`,
      };
    }
  }
  return {
    status: 'warn',
    message: '已被另一个项目的 Zhin 网关占用（无法确定是哪个项目）',
    fix: `到那个项目目录运行 zhin stop，${stop}`,
  };
}
