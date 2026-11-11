import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';

export type PackageManagerName = 'pnpm' | 'npm' | 'yarn' | 'bun';

const LOCKFILES: readonly (readonly [string, PackageManagerName])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/** `package.json#packageManager`, then lockfiles; pnpm is the scaffold default. */
export async function detectPackageManager(projectRoot: string): Promise<PackageManagerName> {
  try {
    const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as { packageManager?: unknown };
    const declared = typeof manifest.packageManager === 'string' ? manifest.packageManager.split('@')[0] : undefined;
    if (declared === 'pnpm' || declared === 'npm' || declared === 'yarn' || declared === 'bun') return declared;
  } catch { /* fall through to lockfiles */ }
  for (const [file, name] of LOCKFILES) {
    if (await access(join(projectRoot, file)).then(() => true, () => false)) return name;
  }
  return 'pnpm';
}

/**
 * Maps the workflow's pnpm invocation (`add|remove [-w] [-D] <spec>`) and the gateway's
 * `update [-w] [<name>…]` / `install [--frozen-lockfile]` to another manager.
 * Unknown flags are refused rather than forwarded.
 */
export function translatePackageManagerArgs(manager: PackageManagerName, args: readonly string[]): readonly string[] {
  const [command, ...rest] = args;
  if (command === 'install') {
    const frozen = rest.includes('--frozen-lockfile');
    if (rest.some(arg => arg !== '--frozen-lockfile')) throw new Error('Unsupported package-manager flag');
    if (!frozen) return ['install'];
    return manager === 'npm' ? ['ci'] : ['install', '--frozen-lockfile'];
  }
  if (command !== 'add' && command !== 'remove' && command !== 'update') throw new Error(`Unsupported package-manager command: ${String(command)}`);
  const workspace = rest.includes('-w');
  const dev = rest.includes('-D');
  const specs = rest.filter(arg => arg !== '-w' && arg !== '-D');
  if (specs.some(spec => spec.startsWith('-'))) throw new Error('Unsupported package-manager flag');
  if (command === 'update') {
    if (dev) throw new Error('Unsupported package-manager flag');
    switch (manager) {
      case 'pnpm': return ['update', ...(workspace ? ['-w'] : []), ...specs];
      case 'npm': return ['update', ...specs];
      case 'yarn': return ['upgrade', ...specs];
      case 'bun': return ['update', ...specs];
    }
  }
  if (command !== 'add' && command !== 'remove') throw new Error('unreachable');
  switch (manager) {
    case 'pnpm': return [command, ...(workspace ? ['-w'] : []), ...(dev ? ['-D'] : []), ...specs];
    case 'npm': return [command === 'add' ? 'install' : 'uninstall', ...(dev ? ['--save-dev'] : []), ...specs];
    case 'yarn': return [command, ...(workspace ? ['-W'] : []), ...(dev ? ['-D'] : []), ...specs];
    case 'bun': return [command, ...(dev ? ['-d'] : []), ...specs];
  }
}

/** How to spawn one command without `shell: true`. */
export interface ResolvedCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Set for `cmd.exe /d /s /c "…"`: the command line is already quoted. */
  readonly windowsVerbatimArguments?: boolean;
}

export interface ResolveCommandOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  /** File probe; defaults to a synchronous `stat().isFile()`. */
  readonly isFile?: (path: string) => boolean;
}

// cmd.exe metacharacters (same set as cross-spawn).
const CMD_META = /([()\][%!^"`<>&|;, *?])/gu;

/** Quotes one argument for `CommandLineToArgvW`, then escapes cmd metacharacters. */
export function quoteWindowsCmdArgument(argument: string, doubleEscape: boolean): string {
  let quoted = argument
    // Backslashes before a quote are doubled and the quote is escaped.
    .replace(/(\\*)"/gu, '$1$1\\"')
    // Trailing backslashes are doubled (they precede the closing quote).
    .replace(/(\\+)$/u, '$1$1');
  quoted = `"${quoted}"`.replace(CMD_META, '^$1');
  // Package-manager shims (`pnpm.cmd`) re-expand `%*`, so metacharacters are parsed twice.
  return doubleEscape ? quoted.replace(CMD_META, '^$1') : quoted;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find(item => item.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function defaultIsFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

/**
 * Resolves a package-manager command for `spawn` / `execFile` without a shell. POSIX: unchanged.
 * Windows: `PATH` × `PATHEXT` lookup; an `.exe` / `.com` runs directly, a `.cmd` / `.bat` shim
 * (or an unresolved name, assumed to be `<name>.cmd`) runs through `cmd.exe /d /s /c` with every
 * argument quoted and its metacharacters escaped, since Node refuses to spawn batch files directly.
 */
export function resolveCommand(name: string, args: readonly string[], options: ResolveCommandOptions = {}): ResolvedCommand {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return Object.freeze({ command: name, args: Object.freeze([...args]) });
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? defaultIsFile;
  const extensions = (envValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.trim()).filter(Boolean);
  const directories = (envValue(env, 'PATH') ?? '').split(';').map(dir => dir.trim().replace(/^"(.*)"$/u, '$1')).filter(Boolean);
  let resolved: string | undefined;
  if (/[\\/]/u.test(name) || win32.extname(name)) resolved = name;
  else {
    search: for (const directory of directories) {
      for (const extension of extensions) {
        const candidate = win32.join(directory, `${name}${extension.toLowerCase()}`);
        if (isFile(candidate)) { resolved = candidate; break search; }
      }
    }
  }
  const target = resolved ?? `${name}.cmd`;
  const extension = win32.extname(target).toLowerCase();
  if (extension === '.exe' || extension === '.com') return Object.freeze({ command: target, args: Object.freeze([...args]) });
  const doubleEscape = extension === '.cmd' || extension === '.bat';
  const line = [win32.normalize(target).replace(CMD_META, '^$1'), ...args.map(arg => quoteWindowsCmdArgument(arg, doubleEscape))].join(' ');
  return Object.freeze({
    command: envValue(env, 'COMSPEC') ?? 'cmd.exe',
    args: Object.freeze(['/d', '/s', '/c', `"${line}"`]),
    windowsVerbatimArguments: true,
  });
}

export type PackageManagerOutput = (stream: 'stdout' | 'stderr', chunk: string) => void;

export interface StreamingPackageManagerOptions {
  /** Fixed manager; otherwise detected per project root. */
  readonly manager?: PackageManagerName;
  /** Injection point for tests. */
  readonly spawn?: typeof spawn;
  readonly env?: NodeJS.ProcessEnv;
  /** Platform used for command resolution (tests). */
  readonly platform?: NodeJS.Platform;
}

/**
 * An `installDependencies` implementation for `PluginManagementWorkflow` that streams output.
 * No shell: the command and every argument are passed as an argv array.
 */
export function createStreamingPackageManager(
  output: PackageManagerOutput,
  options: StreamingPackageManagerOptions = {},
): (args: readonly string[], projectRoot: string) => Promise<void> {
  const run = options.spawn ?? spawn;
  return async (args, projectRoot) => {
    const manager = options.manager ?? await detectPackageManager(projectRoot);
    const argv = translatePackageManagerArgs(manager, args);
    await new Promise<void>((resolvePromise, reject) => {
      const env = options.env ?? process.env;
      const resolved = resolveCommand(manager, argv, { env, ...(options.platform ? { platform: options.platform } : {}) });
      const child = run(resolved.command, [...resolved.args], {
        cwd: projectRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        windowsHide: true,
        ...(resolved.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => output('stdout', chunk));
      child.stderr?.on('data', (chunk: string) => output('stderr', chunk));
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${manager} ${argv[0]} exited with ${signal ?? `code ${code}`}`));
      });
    });
  };
}
