#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', 'lib', 'dist', '.git', 'rename-']);

const REPLACEMENTS = [
  ['Bot 不存在', 'Endpoint 不存在'],
  ['Bot 未连接', 'Endpoint 未连接'],
  ['没有在线的 Bot', '没有在线的 Endpoint'],
  ['在线 Bot', '在线 Endpoint'],
  ['指定 Endpoint ID，不传则使用该适配器下第一个在线 Bot', '指定 Endpoint ID，不传则使用该适配器下第一个在线 Endpoint'],
  ['下的 Bot，请使用', '下的 Endpoint，请使用'],
  ['Adapter/Bot/Message', 'Adapter/Endpoint/Message'],
  ['${className}Bot', '${className}Endpoint'],
  ['new ${className}Bot', 'new ${className}Endpoint'],
  ['implements Endpoint<any,', 'implements Endpoint<'],
  ['  Bot,', '  Endpoint,'],
  ['export class MyBot', 'export class MyEndpoint'],
  ['MyBotConfig', 'MyEndpointConfig'],
  ['bot?: string', 'endpoint?: string'],
  ['overrides.bot', 'overrides.endpoint'],
  ['const bot = overrides.bot', 'const endpoint = overrides.endpoint ?? overrides.endpoint'],
  ['$endpoint: bot,', '$endpoint: endpoint,'],
  ['bot.login.pending', 'endpoint.login.pending'],
  ['initBotHub', 'initEndpointHub'],
  ['from "../src/bot.js"', 'from "../src/endpoint.js"'],
  ['from \'../src/bot.js\'', 'from \'../src/endpoint.js\''],
];

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name) || [...SKIP].some((s) => e.name.includes(s))) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|md|mdc|yml|yaml)$/.test(e.name)) out.push(p);
  }
  return out;
}

let n = 0;
for (const f of walk(ROOT)) {
  let raw = fs.readFileSync(f, 'utf8');
  let next = raw;
  for (const [a, b] of REPLACEMENTS) next = next.split(a).join(b);
  if (next !== raw) {
    fs.writeFileSync(f, next);
    n++;
  }
}
console.log(`pass4: ${n}`);
