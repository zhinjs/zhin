#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', '.turbo']);

const REPLACEMENTS = [
  ['./bot.js', './endpoint.js'],
  ["from '../src/bot'", "from '../src/endpoint.js'"],
  ["from '../src/bot.js'", "from '../src/endpoint.js'"],
  ['import { Bot, DatabaseConfig', 'import { Endpoint, DatabaseConfig'],
  ['  Bot,\n  Message,', '  Endpoint,\n  Message,'],
  ['  Bot,\n  PrivateMessageEvent', '  Bot as QQOfficialClient,\n  PrivateMessageEvent'],
  ['Endpoint as ZhinBot', 'Endpoint'],
  ['extends QQOfficialClient', 'extends QQOfficialClient'], // noop
  ['QQBot[', 'QQEndpoint['],
  ['new QQBot(', 'new QQEndpoint('],
  ['implements QQBot', 'implements QQEndpoint'],
  ["bot: 'test-bot'", "endpoint: 'test-bot'"],
  ['connect-bots', 'connect-endpoints'],
  ['initBotHub', 'initEndpointHub'],
  ['endpoint-hub.ts', 'endpoint-hub.ts'],
];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else if (/\.(ts|tsx|md|yml|yaml)$/.test(ent.name)) files.push(p);
  }
  return files;
}

let n = 0;
for (const file of walk(ROOT)) {
  if (file.includes('rename-bot-to-endpoint')) continue;
  let raw = fs.readFileSync(file, 'utf8');
  let next = raw;
  for (const [a, b] of REPLACEMENTS) next = next.split(a).join(b);
  if (next !== raw) {
    fs.writeFileSync(file, next);
    n++;
  }
}
console.log(`Pass3: ${n} files`);
