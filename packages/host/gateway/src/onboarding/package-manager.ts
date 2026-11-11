import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
 * Maps the workflow's pnpm invocation (`add|remove [-w] [-D] <spec>`) to another manager.
 * Unknown flags are refused rather than forwarded.
 */
export function translatePackageManagerArgs(manager: PackageManagerName, args: readonly string[]): readonly string[] {
  const [command, ...rest] = args;
  if (command !== 'add' && command !== 'remove') throw new Error(`Unsupported package-manager command: ${String(command)}`);
  const workspace = rest.includes('-w');
  const dev = rest.includes('-D');
  const specs = rest.filter(arg => arg !== '-w' && arg !== '-D');
  if (specs.some(spec => spec.startsWith('-'))) throw new Error('Unsupported package-manager flag');
  switch (manager) {
    case 'pnpm': return [command, ...(workspace ? ['-w'] : []), ...(dev ? ['-D'] : []), ...specs];
    case 'npm': return [command === 'add' ? 'install' : 'uninstall', ...(dev ? ['--save-dev'] : []), ...specs];
    case 'yarn': return [command, ...(workspace ? ['-W'] : []), ...(dev ? ['-D'] : []), ...specs];
    case 'bun': return [command, ...(dev ? ['-d'] : []), ...specs];
  }
}

export type PackageManagerOutput = (stream: 'stdout' | 'stderr', chunk: string) => void;

export interface StreamingPackageManagerOptions {
  /** Fixed manager; otherwise detected per project root. */
  readonly manager?: PackageManagerName;
  /** Injection point for tests. */
  readonly spawn?: typeof spawn;
  readonly env?: NodeJS.ProcessEnv;
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
      const child = run(manager, [...argv], {
        cwd: projectRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env ?? process.env,
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
