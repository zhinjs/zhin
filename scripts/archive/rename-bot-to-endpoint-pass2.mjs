#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'lib', 'dist', '.git', '.turbo', 'coverage']);

const REPLACEMENTS = [
  // Restore external qq-official-bot SDK type (broken by pass1)
  ['import type { Endpoint } from "qq-official-bot"', 'import type { Bot as QQOfficialBot } from "qq-official-bot"'],
  ['Endpoint.Config<T, M>', 'QQOfficialBot.Config<T, M>'],
  ['import type { Endpoint } from \'qq-official-bot\'', 'import type { Bot as QQOfficialBot } from \'qq-official-bot\''],
  ["from './bot.js'", "from './endpoint.js'"],
  ["from '../bot.js'", "from '../endpoint.js'"],
  ["from '../../bot.js'", "from '../../endpoint.js'"],
  ["from '../../../bot.js'", "from '../../../endpoint.js'"],
  ["from './bot-base.js'", "from './endpoint-base.js'"],
  ["from './bot-ws.js'", "from './endpoint-ws.js'"],
  ["from './bot-wss.js'", "from './endpoint-wss.js'"],
  ["from './bot-webhook.js'", "from './endpoint-webhook.js'"],
  ["from './bot-http.js'", "from './endpoint-http.js'"],
  ["from './bot-interactions.js'", "from './endpoint-interactions.js'"],
  ["from './bot-sse.js'", "from './endpoint-sse.js'"],
  ["from '../src/bot.js'", "from '../src/endpoint.js'"],
  ["from '../src/bot-ws.js'", "from '../src/endpoint-ws.js'"],
  ["from '../src/bot-webhook.js'", "from '../src/endpoint-webhook.js'"],
  ["from '../src/bot-base.js'", "from '../src/endpoint-base.js'"],
  ['connect-endpoints.js', 'connect-endpoints.js'],
  ['import {Bot} from "./bot.js"', 'import { Endpoint } from "./endpoint.js"'],
  ['import { Endpoint } from "./bot.js"', 'import { Endpoint } from "./endpoint.js"'],
  ['R extends Endpoint = Bot', 'R extends Endpoint = Endpoint'],
  ['Bot.Config', 'Endpoint.Config'],
  ['QuotableBot', 'QuotableEndpoint'],
  ['export { QQBot }', 'export { QQEndpoint }'],
  ['import { QQBot }', 'import { QQEndpoint }'],
  ['class QQBot', 'class QQEndpoint'],
  ['QQBot<', 'QQEndpoint<'],
  ['connectEndpoints', 'connectEndpoints'],
  ['  bot:string', '  endpoint:string'],
  ["description: 'Bot ", "description: 'Endpoint "],
  ["description: \"Bot ", "description: \"Endpoint "],
  ['Bot ID', 'Endpoint ID'],
  ['Bot QQ号', 'Endpoint QQ号'],
  ['Bot 名称', 'Endpoint 名称'],
  ['Bot not found', 'Endpoint not found'],
  ['Bot non-existent', 'Endpoint non-existent'],
  ['from \'./bot-hub', "from './endpoint-hub"],
  ['from "./bot-hub', 'from "./endpoint-hub'],
  ['from \'./bot-persistence', "from './endpoint-persistence"],
  ['from "./bot-persistence', 'from "./endpoint-persistence'],
  ['from \'./bot-db-models', "from './endpoint-db-models"],
  ['initBotHub', 'initEndpointHub'],
  ['setBotHubWss', 'setEndpointHubWss'],
  // tool schema keys
  ["bot: { type:", "endpoint: { type:"],
  ['readonly icon = \'Bot\'', "readonly icon = 'Endpoint'"],
];

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files);
    else files.push(p);
  }
  return files;
}

function shouldProcess(file) {
  const ext = path.extname(file);
  return ['.ts', '.tsx', '.md', '.mdc', '.yml', '.yaml', '.json', '.mjs'].includes(ext);
}

let changed = 0;
for (const file of walk(ROOT).filter(shouldProcess)) {
  if (file.includes('rename-bot-to-endpoint')) continue;
  const raw = fs.readFileSync(file, 'utf8');
  let next = raw;
  for (const [from, to] of REPLACEMENTS) {
    if (from === to) continue;
    next = next.split(from).join(to);
  }
  if (next !== raw) {
    fs.writeFileSync(file, next);
    changed++;
  }
}
console.log(`Pass2 updated ${changed} files`);
