#!/usr/bin/env node
/**
 * 门禁：zhin.features 引用的包必须出现在 dependencies / peerDependencies / optionalDependencies。
 * runtime@1.0.12+ 在解析 Feature 时要求包可被 node_modules 解析，
 * workspace 内由 carrier 兜底，但发布后用户安装需要显式 peer 声明。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLUGIN_DIRS = [
  'plugins/adapters',
  'plugins/utils',
  'plugins/features',
  'plugins/games',
];

const errors = [];

for (const dir of PLUGIN_DIRS) {
  const base = path.join(repoRoot, dir);
  if (!fs.existsSync(base)) continue;

  for (const name of fs.readdirSync(base)) {
    const pkgPath = path.join(base, name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const features = pkg.zhin?.features;
    if (!Array.isArray(features) || features.length === 0) continue;

    const declared = {
      ...pkg.dependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    };

    for (const ref of features) {
      if (!ref.package) continue;
      if (!(ref.package in declared)) {
        errors.push(`${dir}/${name}: zhin.features references "${ref.package}" but it is not in dependencies/peerDependencies/optionalDependencies`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('Feature peer dependency check FAILED:\n');
  for (const e of errors) console.error('  ' + e);
  console.error(`\n${errors.length} missing declaration(s). Add them to peerDependencies.`);
  process.exit(1);
}

console.log('Feature peer dependency check passed.');
