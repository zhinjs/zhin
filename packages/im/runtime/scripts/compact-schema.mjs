import { readFile, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';

// Keep the authored schema readable; avoid shipping TypeScript's expanded JSON indentation.
const output = new URL('../lib/host-config-schema.json', import.meta.url);
const schema = JSON.parse(await readFile(output, 'utf8'));
await writeFile(output, `${JSON.stringify(schema)}\n`);
