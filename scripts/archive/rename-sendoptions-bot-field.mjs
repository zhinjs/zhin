#!/usr/bin/env node
/** Fix SendOptions.bot → endpoint in object literals (heuristic). */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', 'lib', 'dist', '.git']);

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

// Replace `bot:` at line start indent in likely SendOptions blocks — broad but needed
const RE = /^(\s+)bot: /gm;

let n = 0;
for (const f of walk(ROOT)) {
  if (f.includes('rename-')) continue;
  const raw = fs.readFileSync(f, 'utf8');
  const next = raw.replace(RE, '$1endpoint: ');
  if (next !== raw) {
    fs.writeFileSync(f, next);
    n++;
  }
}
console.log(`sendOptions field: ${n} files`);
