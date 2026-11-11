#!/usr/bin/env node
/**
 * 从国务院公示数据源（holiday-cn）同步指定年份到 src/data/holidays/{year}.json
 * Usage: pnpm --filter @zhin.js/schedule sync-holiday 2027 (build first)
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2000) {
  console.error('Usage: pnpm --filter @zhin.js/schedule sync-holiday <year>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { fetchHolidayYearData } = await import(pathToFileURL(join(root, 'lib/index.js')).href);

const data = await fetchHolidayYearData(year);
const target = join(root, 'src/data/holidays', `${year}.json`);
await writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Synced ${target} from holiday-cn (gov.cn papers)`);
