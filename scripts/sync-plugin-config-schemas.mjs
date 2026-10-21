#!/usr/bin/env node
/**
 * 从 `src/config.ts` 的 `Schema.object(...)` 声明生成插件 `schema.json`。
 *
 * - 自动发现 `plugins/<group>/<name>/` 下同时有 `src/config.ts` 与 `schema.json` 的插件。
 * - 仅当 config.ts 含顶层 `export const X = Schema.…` 声明时才会生成；其余插件（手写 schema.json、
 *   使用 interface + resolveXxx 的配置模块）显式跳过并打印原因，不会被误生成。
 * - 只导入声明模块；插件入口与 setup 不会被执行。
 *
 * 用法：
 *   node scripts/sync-plugin-config-schemas.mjs          # 重新生成
 *   node scripts/sync-plugin-config-schemas.mjs --check  # 仅校验是否过期（CI / check:plugin-config-schemas）
 */
import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
const DECLARATION = /^export const (\w+)\s*=\s*Schema\./mu;

/** @returns {{ name: string, dir: string }[]} */
function discoverPlugins() {
  const found = [];
  const pluginsDir = resolve(root, 'plugins');
  for (const group of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const plugin of readdirSync(resolve(pluginsDir, group.name), { withFileTypes: true })) {
      if (!plugin.isDirectory()) continue;
      const dir = resolve(pluginsDir, group.name, plugin.name);
      if (existsSync(resolve(dir, 'src/config.ts')) && existsSync(resolve(dir, 'schema.json'))) {
        found.push({ name: `${group.name}/${plugin.name}`, dir });
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** JSON Pointer-ish paths of keywords the Schema DSL cannot express, so regenerating would silently drop them. */
function inexpressibleKeywords(node, path = '') {
  if (node === null || typeof node !== 'object') return [];
  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'pattern' && typeof value === 'string') found.push(`${path}/pattern`);
    else found.push(...inexpressibleKeywords(value, `${path}/${key}`));
  }
  return found;
}

const generated = [];
const skipped = [];
const stale = [];

for (const { name, dir } of discoverPlugins()) {
  const source = await readFile(resolve(dir, 'src/config.ts'), 'utf8');
  const match = DECLARATION.exec(source);
  if (!match) {
    skipped.push(`${name}: src/config.ts has no top-level \`export const X = Schema.…\` declaration (schema.json is hand-maintained)`);
    continue;
  }
  const symbol = match[1];
  const module = await tsImport(pathToFileURL(resolve(dir, 'src/config.ts')).href, import.meta.url);
  const declaration = module[symbol];
  if (typeof declaration?.toJsonSchema !== 'function') {
    skipped.push(`${name}: export \`${symbol}\` has no toJsonSchema()`);
    continue;
  }
  const schema = declaration.toJsonSchema();
  const text = `${JSON.stringify(schema, null, 2)}\n`;
  const file = resolve(dir, 'schema.json');
  const lost = inexpressibleKeywords(JSON.parse(await readFile(file, 'utf8')))
    .filter(keyword => !inexpressibleKeywords(schema).includes(keyword));
  if (lost.length) {
    skipped.push(`${name}: schema.json carries ${lost.join(', ')} which the Schema DSL cannot express; regenerating would drop it`);
    continue;
  }
  if (check) {
    if (await readFile(file, 'utf8') !== text) stale.push(name);
  } else if (await readFile(file, 'utf8') !== text) {
    await writeFile(file, text);
    console.log(`updated ${name}/schema.json`);
  }
  generated.push(name);
}

for (const line of skipped) console.log(`skip ${line}`);

if (check) {
  if (stale.length) {
    console.error(`Stale plugin schema.json: ${stale.join(', ')}\nRun: node scripts/sync-plugin-config-schemas.mjs`);
    process.exit(1);
  }
  console.log(`Plugin config schemas are up to date (${generated.length} checked, ${skipped.length} skipped).`);
} else {
  console.log(`Plugin config schemas synced (${generated.length} generated, ${skipped.length} skipped).`);
}
