/**
 * Gateway version skew (#1250 `gateway-version-skew-after-update`): after an update the running
 * gateway keeps its old code until it is restarted, and `zhin restart` only restarts the instance.
 * `zhin status`, `zhin doctor` and `zhin update` compare the running gateway's version with the
 * `@zhin.js/gateway` a restart would load and print the exact restart command.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { gatewayRestartCommand, type ProcessManager } from './process-manager.js';

const GATEWAY_PACKAGE = '@zhin.js/gateway';

function readVersion(manifest: string): string | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: unknown; version?: unknown };
    return parsed.name === GATEWAY_PACKAGE && typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function gatewayNextTo(packageDir: string): string | undefined {
  // Its own node_modules, the scope sibling (pnpm: .pnpm/<cli>/node_modules/@zhin.js/gateway), then up.
  const candidates = [path.join(packageDir, 'node_modules', GATEWAY_PACKAGE), path.join(path.dirname(packageDir), 'gateway')];
  for (let dir = path.dirname(packageDir); ; dir = path.dirname(dir)) {
    candidates.push(path.join(dir, 'node_modules', GATEWAY_PACKAGE));
    if (path.dirname(dir) === dir) break;
  }
  for (const candidate of candidates) {
    const version = readVersion(path.join(candidate, 'package.json'));
    if (version) return version;
  }
  return undefined;
}

/**
 * The `@zhin.js/gateway` version a restarted gateway of `root` would run: the one next to the
 * project's installed `@zhin.js/cli` (what `zhin start` / the service runs), else the project's own
 * `node_modules/@zhin.js/gateway`, else the one this CLI process resolves. Undefined when none is found.
 */
export function installedGatewayVersion(root: string, options: { readonly selfResolve?: boolean } = {}): string | undefined {
  try {
    const cli = fs.realpathSync(path.join(root, 'node_modules', '@zhin.js', 'cli'));
    const version = gatewayNextTo(cli);
    if (version) return version;
  } catch { /* no project-local CLI */ }
  const direct = readVersion(path.join(root, 'node_modules', GATEWAY_PACKAGE, 'package.json'));
  if (direct || options.selfResolve === false) return direct;
  try {
    const entry = createRequire(import.meta.url).resolve(`${GATEWAY_PACKAGE}/local`);
    for (let dir = path.dirname(entry); path.dirname(dir) !== dir; dir = path.dirname(dir)) {
      const version = readVersion(path.join(dir, 'package.json'));
      if (version) return version;
    }
  } catch { /* not resolvable */ }
  return undefined;
}

export interface GatewayVersionSkew {
  readonly running: string;
  readonly installed: string;
  /** The exact restart command; undefined for a foreground gateway in a terminal. */
  readonly restart?: string;
}

/** Undefined when the versions match or the installed one is unknown. */
export function gatewayVersionSkew(
  gateway: Readonly<{ pid: number; mode: 'foreground' | 'daemon'; version: string }>,
  installed: string | undefined,
  manager?: ProcessManager,
): GatewayVersionSkew | undefined {
  if (!installed || installed === gateway.version) return undefined;
  // An undefined manager is detected from the gateway process (see gatewayRestartCommand).
  const restart = gatewayRestartCommand(gateway, manager);
  return { running: gateway.version, installed, ...(restart ? { restart } : {}) };
}

/** Chinese lines for a skew: what differs and the command that fixes it. */
export function formatGatewayVersionSkew(skew: GatewayVersionSkew): string[] {
  return [
    `网关版本不一致：运行中 v${skew.running}，已安装 v${skew.installed}；重启网关后才会用上新版本（zhin restart 只重启实例）`,
    skew.restart
      ? `  重启网关：${skew.restart}`
      : '  重启网关：在运行网关的终端按 Ctrl+C，然后重新执行 zhin start --foreground（沿用原参数）',
  ];
}
