import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Convention directories and entries the Plugin Runtime loads from an installed package. */
// `pages/` is bundled for the Console in the browser, so it is not loaded by the Node runtime.
const RUNTIME_PATH = /^(?:src|agents|commands|tools|middlewares|handlers|components|skills|adapters|schedules|hooks|mcps|prompt-sections)\/|^(?:plugin|index)\.tsx?$/u;
// Static value imports only: a dynamic `import()` is the pattern for a guarded optional module.
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s*['"]([^'"./][^'"]*)['"]/gu;
/** Documented optional peers the user installs alongside the plugin (see the plugin README). */
const USER_INSTALLED_PEERS: Readonly<Record<string, readonly string[]>> = {
  '@zhin.js/adapter-icqq': ['@icqqjs/icqq'],
};
const BUILTIN = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
}

/**
 * The Plugin Runtime imports a plugin's convention directories (tools, commands, …) at startup,
 * whether or not the Agent is installed. A third-party module they import must therefore be a real
 * dependency of that plugin: an optional peer (or a dev dependency) is not installed in a generated
 * project, and startup fails with "Cannot find package" (zod in adapter-telegram's Agent tools).
 * `zhin.js` / `@zhin.js/*` peers are provided by the Host install and are out of scope here.
 */
describe('Plugin third-party runtime dependencies', () => {
  it('declares every third-party module a plugin loads at run time as a dependency', () => {
    const files = execFileSync('git', ['ls-files', 'plugins'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const manifests = files.filter((file) => /^plugins\/[^/]+\/[^/]+\/package\.json$/u.test(file));
    const missing: string[] = [];
    for (const manifestPath of manifests) {
      const manifest = JSON.parse(readFileSync(`${root}/${manifestPath}`, 'utf8')) as {
        name: string; private?: boolean;
        dependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      };
      if (manifest.private) continue;
      const dir = dirname(manifestPath);
      const required = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}).filter((name) => !manifest.peerDependenciesMeta?.[name]?.optional),
      ]);
      for (const file of files) {
        if (!file.startsWith(`${dir}/`) || !/\.(?:ts|tsx|mts)$/u.test(file) || /\/tests?\/|\.test\./u.test(file)) continue;
        const rel = file.slice(dir.length + 1);
        if (!RUNTIME_PATH.test(rel)) continue;
        for (const match of readFileSync(`${root}/${file}`, 'utf8').matchAll(IMPORT)) {
          const name = packageName(match[1]!);
          if (BUILTIN.has(name) || name === 'zhin.js' || name.startsWith('@zhin.js/') || name === manifest.name) continue;
          if (USER_INSTALLED_PEERS[manifest.name]?.includes(name)) continue;
          if (!required.has(name)) missing.push(`${manifest.name}: ${rel} imports ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
