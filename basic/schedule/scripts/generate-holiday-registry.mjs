#!/usr/bin/env node
/**
 * 根据 src/data/holidays/*.json 重新生成 holiday-registry.ts 中的 bundled imports。
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const holidaysDir = join(root, 'src/data/holidays');
const registryPath = join(root, 'src/data/holiday-registry.ts');

const IMPORTS_START = '// AUTO-GENERATED BUNDLED IMPORTS START';
const IMPORTS_END = '// AUTO-GENERATED BUNDLED IMPORTS END';
const DATA_START = '// AUTO-GENERATED BUNDLED DATA START';
const DATA_END = '// AUTO-GENERATED BUNDLED DATA END';

async function listYears() {
  const files = await readdir(holidaysDir);
  return files
    .filter((name) => /^\d{4}\.json$/.test(name))
    .map((name) => Number(name.slice(0, 4)))
    .sort((a, b) => a - b);
}

function renderImports(years) {
  return years.map((year) => `import data${year} from './holidays/${year}.json';`).join('\n');
}

function renderBundledData(years) {
  const lines = years.map((year) => `  ${year}: data${year},`);
  return `const BUNDLED_DATA: Record<number, HolidayYearData> = {\n${lines.join('\n')}\n};`;
}

function replaceBlock(source, start, end, content) {
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'm');
  if (!pattern.test(source)) {
    throw new Error(`Markers not found in ${registryPath}: ${start}`);
  }
  return source.replace(pattern, `${start}\n${content}\n${end}`);
}

async function main() {
  const years = await listYears();
  if (years.length === 0) {
    throw new Error(`No holiday JSON files found in ${holidaysDir}`);
  }

  const source = await readFile(registryPath, 'utf8');
  const next = replaceBlock(
    replaceBlock(source, IMPORTS_START, IMPORTS_END, renderImports(years)),
    DATA_START,
    DATA_END,
    renderBundledData(years),
  );

  if (next !== source) {
    await writeFile(registryPath, next, 'utf8');
    console.log(`Regenerated holiday-registry bundled imports for: ${years.join(', ')}`);
  } else {
    console.log('holiday-registry bundled imports already up to date.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
