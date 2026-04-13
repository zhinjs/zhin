import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const consoleBin = path.resolve(process.cwd(), '../../services/console/lib/bin.js');

if (!fs.existsSync(consoleBin)) {
  console.log('Skipping client build: console not built yet');
  process.exit(0);
}

process.argv = [process.argv[0], consoleBin, 'build'];
await import(pathToFileURL(consoleBin).href);
