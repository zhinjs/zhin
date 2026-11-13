#!/usr/bin/env node
/**
 * 门禁：zhin.features 引用的包必须出现在 dependencies / peerDependencies / optionalDependencies。
 * runtime@1.0.12+ 在解析 Feature 时要求包可被 node_modules 解析，
 * workspace 内由 carrier 兜底，但发布后用户安装需要显式 peer 声明。
 * 省略 zhin.features 时，约定目录推断出的 Feature 包同样必须声明（与 Runtime 推断同源）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferConventionFeatureReferences } from '../packages/im/runtime/src/convention-features.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLUGIN_DIRS = [
  'plugins/adapters',
  'plugins/utils',
  'plugins/features',
  'plugins/games',
  'plugins/services',
];

const errors = [];

for (const dir of PLUGIN_DIRS) {
  const base = path.join(repoRoot, dir);
  if (!fs.existsSync(base)) continue;

  for (const name of fs.readdirSync(base)) {
    const pkgPath = path.join(base, name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const features = Array.isArray(pkg.zhin?.features) ? pkg.zhin.features : [];
    const inferred = inferConventionFeatureReferences(path.join(base, name), pkg.zhin);
    if (features.length === 0 && inferred.length === 0) continue;

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
    for (const ref of inferred) {
      if (!(ref.package in declared)) {
        errors.push(`${dir}/${name}: convention directory ${ref.directory}/ implies Feature "${ref.package}" but it is not in dependencies/peerDependencies/optionalDependencies`);
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
