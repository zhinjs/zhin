#!/usr/bin/env node
/**
 * 批量从 holiday-cn 同步国务院公示节假日，供 CI 定时任务使用。
 * 输出 GITHUB_OUTPUT: changed, changed_years
 */
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const holidaysDir = join(root, 'src/data/holidays');

async function listLocalYears() {
  const files = await readdir(holidaysDir);
  return files
    .filter((name) => /^\d{4}\.json$/.test(name))
    .map((name) => Number(name.slice(0, 4)))
    .sort((a, b) => a - b);
}

function serialize(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function writeGithubOutput(changed, changedYears) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }
  await appendFile(
    outputPath,
    `changed=${changed}\nchanged_years=${changedYears.join(',')}\n`,
  );
}

function runGenerateRegistry() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/generate-holiday-registry.mjs'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

async function main() {
  const { fetchHolidayYearData } = await import(join(root, 'dist/index.mjs'));

  const calendarYear = new Date().getFullYear();
  const localYears = await listLocalYears();
  const yearsToTry = [
    ...new Set([
      ...localYears.filter((year) => year >= calendarYear - 1),
      calendarYear,
      calendarYear + 1,
    ]),
  ].sort((a, b) => a - b);

  const changedYears = [];

  for (const year of yearsToTry) {
    const target = join(holidaysDir, `${year}.json`);
    try {
      const fetched = await fetchHolidayYearData(year);
      const nextContent = serialize(fetched);
      let previousContent = null;
      try {
        previousContent = await readFile(target, 'utf8');
      } catch {
        // new year file
      }

      if (previousContent !== nextContent) {
        await writeFile(target, nextContent, 'utf8');
        changedYears.push(year);
        console.log(`Updated ${target}`);
      } else {
        console.log(`No change ${target}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`Skip ${year}: ${message}`);
    }
  }

  const changed = changedYears.length > 0;

  if (changed) {
    await runGenerateRegistry();
  } else {
    console.log('Holiday data is up to date.');
  }

  await writeGithubOutput(changed, changedYears);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
