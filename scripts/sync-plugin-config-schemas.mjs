import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';

const root = fileURLToPath(new URL('..', import.meta.url));
// Only declaration helpers are imported. Plugin entries and setup never execute.
const declarations = [['calendar', 'calendarConfig'], ['reminder', 'reminderConfig'], ['repeater', 'repeaterConfig']];
for (const [name, symbol] of declarations) {
  const module = await tsImport(pathToFileURL(resolve(root, `plugins/utils/${name}/src/config.ts`)).href, import.meta.url);
  const text = `${JSON.stringify(module[symbol].toJsonSchema(), null, 2)}\n`;
  const file = resolve(root, `plugins/utils/${name}/schema.json`);
  if (process.argv.includes('--check')) {
    if (await readFile(file, 'utf8') !== text) throw new Error(`${name}/schema.json is stale; run node scripts/sync-plugin-config-schemas.mjs`);
  } else await writeFile(file, text);
}
