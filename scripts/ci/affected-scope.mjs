import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWorkspaceGraph } from '../lib/workspace-graph.mjs';
import { comparison, writeOutputs } from './validation-plan.mjs';

/** Include runtime, dev, peer and declared Feature edges, not just runtime imports. */
export function affectedScope({ changed, packages, tests }) {
  const ownerOf = file => packages.filter(pkg => file.startsWith(`${pkg.dir}/`)).sort((a, b) => b.dir.length - a.dir.length)[0];
  const all = changed.some(file => /^tests\/(?!docs\/)/.test(file) || !ownerOf(file) && !/^(?:docs\/|\.github\/|scripts\/|tests\/|\.changeset\/|README|LICENSE|\.gitignore)/.test(file));
  const affected = new Set(all ? packages.map(pkg => pkg.name) : changed.flatMap(file => ownerOf(file)?.name ?? []));
  let grew = true;
  while (grew) {
    grew = false;
    for (const pkg of packages) if (!affected.has(pkg.name) && pkg.dependencies.some(name => affected.has(name))) {
      affected.add(pkg.name); grew = true;
    }
  }
  const infrastructure = changed.some(file => /^(?:\.github\/|scripts\/|tests\/|docs\/)/.test(file));
  const selected = tests.filter(file => all || affected.has(ownerOf(file)?.name)
    || infrastructure && /^(?:scripts\/|tests\/docs\/)/.test(file)
    || changed.includes(file));
  const builds = packages.filter(pkg => affected.has(pkg.name) && pkg.dir !== 'docs').map(pkg => pkg.name).sort();
  const lint = changed.filter(file => /\.[cm]?[jt]sx?$/.test(file));
  return { all, builds, tests: selected.sort(), lint };
}

export function readScope(root, base, head) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const changed = git('diff', '--name-only', '-z', base, head).split('\0').filter(Boolean);
  const graph = readWorkspaceGraph();
  const packages = [...graph.values()].map(pkg => {
    const manifest = JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8'));
    return { ...pkg, dependencies: [...new Set([
      ...pkg.dependencies, ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}),
      ...(manifest.zhin?.features ?? []).map(feature => feature.package),
    ])] };
  });
  const tests = git('ls-files', '-z').split('\0').filter(file => file.endsWith('.test.ts') && existsSync(join(root, file)));
  const scope = affectedScope({ changed, packages, tests });
  return { ...scope, base, head, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const refs = comparison(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_SHA);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  const base = /^[a-f0-9]{40}$/.test(refs.base ?? '') && !/^0+$/.test(refs.base) ? refs.base : git('rev-parse', `${process.env.GITHUB_SHA}^`);
  const scope = readScope(process.cwd(), base, process.env.GITHUB_SHA);
  writeOutputs({ scope: JSON.stringify(scope), builds: scope.builds.length > 0, tests: scope.tests.length > 0 });
  console.log(`${scope.changed.length} changed files; ${scope.builds.length} affected packages; ${scope.tests.length} selected test files`);
}
