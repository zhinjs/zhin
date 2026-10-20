// Builds a disposable Zhin application on disk for the end-to-end smoke scenarios.
// Workspace packages are linked, never installed, so the smoke run uses exactly the code in this checkout.
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const linkedFrameworkPackages = [
  'adapter',
  'command',
  'component',
  'core',
  'handler',
  'im-contract',
  'middleware',
  'permission',
  'plugin-runtime',
  'runtime',
  'schedule-feature',
  'skill',
  'tool',
];

const copiedDirectoryNamesToSkip = new Set(['node_modules', 'lib', '.zhin', 'tests']);
const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir';

export class SmokeProject {
  /** @param {string} root */
  constructor(root) {
    this.root = root;
  }

  /** @param {string} relativePath */
  path(relativePath) {
    return join(this.root, relativePath);
  }

  /** @param {string} relativePath @param {string} content */
  async write(relativePath, content) {
    const absolutePath = this.path(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    return absolutePath;
  }

  /** @param {string} relativePath @param {unknown} value */
  async writeJson(relativePath, value) {
    return this.write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  /** @param {string} relativePath */
  async read(relativePath) {
    return readFile(this.path(relativePath), 'utf8');
  }

  /**
   * Copies a repository plugin (sources only) into `plugins/<name>` and reuses its installed dependencies.
   * @param {string} repositoryPluginPath for example `plugins/utils/group-suite`
   * @param {string} name directory name inside the smoke project
   */
  async copyRepositoryPlugin(repositoryPluginPath, name) {
    const source = join(repositoryRoot, repositoryPluginPath);
    const destination = this.path(`plugins/${name}`);
    await cp(source, destination, {
      recursive: true,
      filter: path => !copiedDirectoryNamesToSkip.has(path.split(/[\\/]/u).at(-1)),
    });
    const installedDependencies = await realpath(join(source, 'node_modules'));
    await symlink(installedDependencies, join(destination, 'node_modules'), directoryLinkType);
    return `./plugins/${name}`;
  }

  async dispose() {
    await rm(this.root, { recursive: true, force: true });
  }
}

/**
 * Creates the application directory with linked framework packages. The caller writes package.json,
 * the root plugin entry and the configuration, so each scenario states exactly what the user would have.
 * @param {string} label
 */
export async function createSmokeProject(label) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), `zhin-e2e-smoke-${label}-`));
  const root = await realpath(temporaryDirectory);
  for (const packageName of linkedFrameworkPackages) {
    await linkDirectory(root, `@zhin.js/${packageName}`, join(repositoryRoot, 'packages/im', packageName));
  }
  await linkDirectory(root, 'zhin.js', join(repositoryRoot, 'packages/im/zhin'));
  await linkDirectory(root, '@zhin.js/testing', join(repositoryRoot, 'packages/toolkit/testing'));
  await linkDirectory(root, 'tsx', join(repositoryRoot, 'node_modules/tsx'));
  return new SmokeProject(root);
}

/** @param {string} projectRoot @param {string} packageName @param {string} target */
async function linkDirectory(projectRoot, packageName, target) {
  const destination = join(projectRoot, 'node_modules', packageName);
  await mkdir(dirname(destination), { recursive: true });
  await symlink(target, destination, directoryLinkType);
}
