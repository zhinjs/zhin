import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PackageCutover, type PackageCutoverMode } from './package-cutover.js';

export interface MigrationVerificationCommand {
  readonly command: string;
  readonly arguments: readonly string[];
}

export interface MigrationVerificationReport {
  readonly root: string;
  readonly mode: PackageCutoverMode;
  readonly commands: readonly MigrationVerificationCommand[];
  readonly tarballEntries: readonly string[];
}

export interface MigrationVerificationRunner {
  run(command: string, arguments_: readonly string[], cwd: string): Promise<void>;
}

/** Verifies that a completed cutover can be built and, when public, packed offline. */
export class MigrationVerifier {
  constructor(private readonly runner: MigrationVerificationRunner = new NodeMigrationVerificationRunner()) {}

  async verify(projectRoot: string): Promise<MigrationVerificationReport> {
    const root = resolve(projectRoot);
    const plan = await new PackageCutover().plan(root);
    if (plan.changed) {
      throw new Error('Migration cutover is incomplete; run zhin runtime migrate cutover --write before verify');
    }

    const pkg = await readPackage(plan.packageFile);
    assertStartScripts(pkg, plan.mode);
    const commands: MigrationVerificationCommand[] = [{
      command: 'pnpm',
      arguments: Object.freeze(['run', 'build']),
    }];
    await this.runner.run('pnpm', commands[0]!.arguments, root);

    if (plan.mode === 'development') {
      return Object.freeze({
        root,
        mode: plan.mode,
        commands: Object.freeze(commands),
        tarballEntries: Object.freeze([]),
      });
    }

    const destination = await mkdtemp(join(tmpdir(), 'zhin-migration-pack-'));
    try {
      const packArguments = Object.freeze([
        'pack',
        '--pack-destination',
        destination,
      ]);
      commands.push({ command: 'pnpm', arguments: packArguments });
      await this.runner.run('pnpm', packArguments, root);
      const archive = await packedArchive(destination);
      const entries = await tarEntries(archive);
      assertPublishedTarball(entries, './plugin.js', plan.capabilities, await readPackageFromTarball(entries));
      return Object.freeze({
        root,
        mode: plan.mode,
        commands: Object.freeze(commands),
        tarballEntries: Object.freeze(entries.map((entry) => entry.name)),
      });
    } finally {
      await rm(destination, { force: true, recursive: true });
    }
  }
}

export class NodeMigrationVerificationRunner implements MigrationVerificationRunner {
  async run(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, arguments_, {
        cwd,
        stdio: 'pipe',
        // verify never installs. Disable Corepack's packageManager write so
        // temporary and user projects remain unchanged after verification.
        env: { ...process.env, COREPACK_ENABLE_PROJECT_SPEC: '0', npm_config_offline: 'true' },
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk; });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk; });
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolvePromise();
        else reject(new Error(`${command} ${arguments_.join(' ')} failed (${code ?? 'signal'}): ${output.trim()}`));
      });
    });
  }
}

interface PackageJson {
  readonly scripts?: Record<string, unknown>;
  readonly zhin?: { readonly entry?: unknown };
}

interface TarEntry {
  readonly name: string;
  readonly content: Buffer;
}

async function readPackage(file: string): Promise<PackageJson> {
  const value = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file} must be an object`);
  return value as PackageJson;
}

function assertStartScripts(pkg: PackageJson, mode: PackageCutoverMode): void {
  if (pkg.scripts?.dev !== 'zhin runtime start' || pkg.scripts.start !== 'zhin runtime start') {
    throw new Error(`${mode} migration must retain dev and start as "zhin runtime start"`);
  }
  if (typeof pkg.scripts.build !== 'string') throw new Error(`${mode} migration requires a build script`);
}

async function packedArchive(destination: string): Promise<string> {
  const archives = (await readdir(destination))
    .filter((file) => file.endsWith('.tgz'))
    .sort((left, right) => left.localeCompare(right));
  if (archives.length !== 1) throw new Error(`Expected exactly one tarball in ${destination}, found ${archives.length}`);
  return join(destination, archives[0]!);
}

async function tarEntries(archive: string): Promise<TarEntry[]> {
  const content = gunzipSync(await readFile(archive));
  const entries: TarEntry[] = [];
  for (let offset = 0; offset + 512 <= content.length;) {
    const header = content.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const size = readTarSize(header.subarray(124, 136));
    if (!name || size < 0 || offset + 512 + size > content.length) {
      throw new Error(`Invalid tar entry in ${basename(archive)}`);
    }
    entries.push(Object.freeze({
      name: prefix ? `${prefix}/${name}` : name,
      content: Buffer.from(content.subarray(offset + 512, offset + 512 + size)),
    }));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readTarString(buffer: Buffer): string {
  const end = buffer.indexOf(0);
  return buffer.subarray(0, end === -1 ? buffer.length : end).toString('utf8').trim();
}

function readTarSize(buffer: Buffer): number {
  const value = readTarString(buffer).trim();
  return value === '' ? 0 : Number.parseInt(value, 8);
}

function readPackageFromTarball(entries: readonly TarEntry[]): PackageJson {
  const entry = entries.find((item) => item.name === 'package/package.json');
  if (!entry) throw new Error('Tarball is missing package/package.json');
  try {
    const value = JSON.parse(entry.content.toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value as PackageJson;
  } catch (error) {
    throw new Error('Tarball package/package.json is invalid', { cause: error });
  }
}

function assertPublishedTarball(
  entries: readonly TarEntry[],
  manifestEntry: './plugin.js',
  capabilities: readonly string[],
  pkg: PackageJson,
): void {
  if (pkg.zhin?.entry !== manifestEntry) {
    throw new Error(`Tarball manifest entry must be ${manifestEntry}`);
  }
  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ['package/plugin.js', 'package/plugin.d.ts']) {
    if (!names.has(required)) throw new Error(`Tarball is missing ${required}`);
  }
  for (const capability of capabilities) {
    const directory = `${capability}s`;
    if (![...names].some((name) => name.startsWith(`package/${directory}/`) && name.endsWith('.js'))) {
      throw new Error(`Tarball is missing compiled ${directory} capability entries`);
    }
  }
}
