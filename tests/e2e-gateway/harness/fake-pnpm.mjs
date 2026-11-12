#!/usr/bin/env node
// Fake `pnpm` for the gateway end-to-end suite: never touches the network or the real store.
// `add <name>@<version>` declares the dependency, appends to the lockfile and writes a package:
//   - a name listed in ZHIN_E2E_LINK_PACKAGES (`name=/abs/dir;…`) is linked to that directory;
//   - any other name becomes a Plugin package whose entry throws on import.
// `install [--frozen-lockfile]` removes packages it created that package.json no longer declares.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2).filter(argument => argument !== '-w');
appendFileSync(join(root, '.fake-pnpm.log'), `${JSON.stringify(args)}\n`);
const manifestPath = join(root, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const lockfile = join(root, 'pnpm-lock.yaml');
const createdFile = join(root, '.fake-pnpm-created.json');
const created = existsSync(createdFile) ? JSON.parse(readFileSync(createdFile, 'utf8')) : [];
const links = new Map((process.env.ZHIN_E2E_LINK_PACKAGES ?? '').split(';').filter(Boolean).map(entry => {
  const index = entry.indexOf('=');
  return [entry.slice(0, index), entry.slice(index + 1)];
}));

function splitSpec(spec) {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at < 0 ? { name: spec, version: '1.0.0' } : { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

const [command, ...rest] = args;
if (command === 'add') {
  for (const spec of rest.filter(argument => !argument.startsWith('-'))) {
    const { name, version } = splitSpec(spec);
    const directory = join(root, 'node_modules', ...name.split('/'));
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(dirname(directory), { recursive: true });
    const linked = links.get(name);
    if (linked) {
      symlinkSync(linked, directory, 'dir');
      const installed = JSON.parse(readFileSync(join(linked, 'package.json'), 'utf8'));
      manifest.dependencies = { ...manifest.dependencies, [name]: installed.version };
    } else {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'package.json'), `${JSON.stringify({
        name,
        version,
        type: 'module',
        main: './plugin.js',
        zhin: { protocol: 1, type: 'plugin', entry: './plugin.js', engine: '^1.0.0', runtime: 'trusted', features: [], plugins: [] },
      }, null, 2)}\n`);
      writeFileSync(join(directory, 'plugin.js'), "throw new Error('e2e broken plugin: entry throws on import');\n");
      manifest.dependencies = { ...manifest.dependencies, [name]: version };
    }
    created.push(name);
    appendFileSync(lockfile, `  ${name}: ${manifest.dependencies[name]}\n`);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(createdFile, JSON.stringify([...new Set(created)]));
  process.stdout.write(`fake pnpm: added ${rest.join(' ')}\n`);
} else if (command === 'install') {
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  for (const name of created) {
    if (!declared.has(name)) rmSync(join(root, 'node_modules', ...name.split('/')), { recursive: true, force: true });
  }
  process.stdout.write(`fake pnpm: install ${rest.join(' ')}\n`);
} else {
  process.stderr.write(`fake pnpm: unsupported command ${String(command)}\n`);
  process.exit(1);
}
