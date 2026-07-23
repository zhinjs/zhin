#!/usr/bin/env node
/**
 * One-shot breaking rename: Bot → Endpoint across the monorepo.
 * Excludes: node_modules, lib, dist, .git, onebot protocol names, dependabot.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules', 'lib', 'dist', '.git', '.turbo', 'coverage', '.pnpm-store',
]);

const SKIP_FILES = new Set([
  'rename-bot-to-endpoint.mjs',
  'pnpm-lock.yaml',
  'dependabot.yml',
]);

/** Longest-first text replacements (content only). */
const REPLACEMENTS = [
  ['InboundBot', 'InboundEndpoint'],
  ['OutboundBot', 'OutboundEndpoint'],
  ['FullBot', 'FullEndpoint'],
  ['CapableBot', 'CapableEndpoint'],
  ['BotCapabilitiesConfig', 'EndpointCapabilitiesConfig'],
  ['BotCapability', 'EndpointCapability'],
  ['DEFAULT_BOT_CAPABILITIES', 'DEFAULT_ENDPOINT_CAPABILITIES'],
  ['registerBotCapabilities', 'registerEndpointCapabilities'],
  ['getBotCapabilities', 'getEndpointCapabilities'],
  ['resolveBotCapabilities', 'resolveEndpointCapabilities'],
  ['connectBotInstance', 'connectEndpointInstance'],
  ['disconnectBotInstance', 'disconnectEndpointInstance'],
  ['connectBots', 'connectEndpoints'],
  ['connect-bots', 'connect-endpoints'],
  ['connect-bot-instance', 'connect-endpoint-instance'],
  ['bot-capabilities', 'endpoint-capabilities'],
  ['bot-lifecycle', 'endpoint-lifecycle'],
  ['emitBotLifecycle', 'emitEndpointLifecycle'],
  ['BotLifecyclePayload', 'EndpointLifecyclePayload'],
  ['BotLifecycleKind', 'EndpointLifecycleKind'],
  ['LifecycleTestBot', 'LifecycleTestEndpoint'],
  ['HarnessTestBot', 'HarnessTestEndpoint'],
  ['OutOnlyBot', 'OutOnlyEndpoint'],
  ['OutOnlyAdapter', 'OutOnlyAdapter'], // noop anchor
  ['ProcessBot', 'ProcessEndpoint'],
  ['SandboxWsBot', 'SandboxWsEndpoint'],
  ['WeChatMPBot', 'WeChatMPEndpoint'],
  ['WeixinIlinkBot', 'WeixinIlinkEndpoint'],
  ['WeixinIlinkBotConfig', 'WeixinIlinkEndpointConfig'],
  ['TelegramBotConfig', 'TelegramEndpointConfig'],
  ['TelegramBot', 'TelegramEndpoint'],
  ['DiscordInteractionsBot', 'DiscordInteractionsEndpoint'],
  ['DiscordBotLike', 'DiscordEndpointLike'],
  ['DiscordBot', 'DiscordEndpoint'],
  ['SlackBotConfig', 'SlackEndpointConfig'],
  ['SlackBot', 'SlackEndpoint'],
  ['KookBotConfig', 'KookEndpointConfig'],
  ['KookBot', 'KookEndpoint'],
  ['LarkBotConfig', 'LarkEndpointConfig'],
  ['LarkBot', 'LarkEndpoint'],
  ['DingTalkBotConfig', 'DingTalkEndpointConfig'],
  ['DingTalkBot', 'DingTalkEndpoint'],
  ['IcqqBotConfig', 'IcqqEndpointConfig'],
  ['IcqqBot', 'IcqqEndpoint'],
  ['GitHubBotConfig', 'GitHubEndpointConfig'],
  ['GitHubBot', 'GitHubEndpoint'],
  ['EmailBotConfig', 'EmailEndpointConfig'],
  ['EmailBot', 'EmailEndpoint'],
  ['NapCatHttpBot', 'NapCatHttpEndpoint'],
  ['NapCatBotBase', 'NapCatEndpointBase'],
  ['NapCatBot', 'NapCatEndpoint'],
  ['MilkyWebhookBot', 'MilkyWebhookEndpoint'],
  ['OneBot12WebhookBot', 'OneBot12WebhookEndpoint'],
  ['SatoriWebhookBot', 'SatoriWebhookEndpoint'],
  ['MockWeChatMPBot', 'MockWeChatMPEndpoint'],
  ['MockWeixinIlinkBot', 'MockWeixinIlinkEndpoint'],
  ['MockKookBot', 'MockKookEndpoint'],
  ['MockNapCatBot', 'MockNapCatEndpoint'],
  ['TestQQBot', 'TestQQEndpoint'],
  ['MockIcqqBot', 'MockIcqqEndpoint'],
  ['MockEmailBot', 'MockEmailEndpoint'],
  ['MockOneBot12Bot', 'MockOneBot12Endpoint'],
  ['MockSatoriBot', 'MockSatoriEndpoint'],
  ['MockSlackBot', 'MockSlackEndpoint'],
  ['MockTelegramBot', 'MockTelegramEndpoint'],
  ['TestSandboxBot', 'TestSandboxEndpoint'],
  ['MockGitHubBot', 'MockGitHubEndpoint'],
  ['MockMilkyBot', 'MockMilkyEndpoint'],
  ['MockOneBot11Bot', 'MockOneBot11Endpoint'],
  ['MockLarkBot', 'MockLarkEndpoint'],
  ['MockDiscordBot', 'MockDiscordEndpoint'],
  ['MockDingTalkBot', 'MockDingTalkEndpoint'],
  ['HarnessTestAdapter', 'HarnessTestAdapter'],
  ['MockBot', 'MockEndpoint'],
  ['StressBot', 'StressEndpoint'],
  ['ExtendedBot', 'ExtendedEndpoint'],
  ['TestBot', 'TestEndpoint'],
  ['MyBot', 'MyEndpoint'],
  ['MyBotConfig', 'MyEndpointConfig'],
  ['InferBot', 'InferEndpoint'],
  ['BotConfig', 'EndpointConfig'],
  ['BotMessage', 'EndpointMessage'],
  ['createBot', 'createEndpoint'],
  ['initBotHub', 'initEndpointHub'],
  ['setBotHubWss', 'setEndpointHubWss'],
  ['bot-hub', 'endpoint-hub'],
  ['bot-persistence', 'endpoint-persistence'],
  ['bot-db-models', 'endpoint-db-models'],
  ['BOT_MANAGEMENT_FEATURES', 'ENDPOINT_MANAGEMENT_FEATURES'],
  ['bot.login.pending', 'endpoint.login.pending'],
  ['bot.lifecycle', 'endpoint.lifecycle'],
  ['bot.connect', 'endpoint.connect'],
  ['bot.disconnect', 'endpoint.disconnect'],
  ['bot.error', 'endpoint.error'],
  ['bot:lifecycle', 'endpoint:lifecycle'],
  ['bot:message', 'endpoint:message'],
  ['botId', 'endpointId'],
  ['bot_id', 'endpoint_id'],
  ['$bot', '$endpoint'],
  ["from './bot.js'", "from './endpoint.js'"],
  ["from './bot.ts'", "from './endpoint.ts'"],
  ["from '../bot.js'", "from '../endpoint.js'"],
  ["from '../../bot.js'", "from '../../endpoint.js'"],
  ['bot-capabilities.test', 'endpoint-capabilities.test'],
  ['bot-lifecycle.test', 'endpoint-lifecycle.test'],
  ['/bot.test.ts', '/endpoint.test.ts'],
  ['export * from \'./bot.js\'', 'export * from \'./endpoint.js\''],
  ['Bot must declare', 'Endpoint must declare'],
  ['Bot capability', 'Endpoint capability'],
  ['`Bot ${', '`Endpoint ${'],
  ['Bot ${', 'Endpoint ${'],
  ['bot ${', 'endpoint ${'],
  ['no outbound capability', 'no outbound capability'],
  ['Adapter.BotConfig', 'Adapter.EndpointConfig'],
  ['namespace Bot', 'namespace Endpoint'],
  ['export type Bot<', 'export type Endpoint<'],
  ['implements Bot<', 'implements Endpoint<'],
  ['implements Bot ', 'implements Endpoint '],
  ['extends Bot<', 'extends Endpoint<'],
  ['extends Bot ', 'extends Endpoint '],
  ['Adapter<', 'Adapter<'], // anchor
  ['<Bot>', '<Endpoint>'],
  ['<Bot,', '<Endpoint,'],
  ['(Bot)', '(Endpoint)'],
  [': Bot', ': Endpoint'],
  [', Bot', ', Endpoint'],
  [' Bot>', ' Endpoint>'],
  [' Bot ', ' Endpoint '],
  [' Bot\n', ' Endpoint\n'],
  [' Bot.', ' Endpoint.'],
  ['/** Bot', '/** Endpoint'],
  ['# Bot', '# Endpoint'],
  ['| Bot', '| Endpoint'],
  ['**Bot**', '**Endpoint**'],
  ['`Bot`', '`Endpoint`'],
  ['.bots', '.endpoints'],
  ['bots?:', 'endpoints?:'],
  ['bots:', 'endpoints:'],
  ['`bots`', '`endpoints`'],
  ['"bots"', '"endpoints"'],
  ["'bots'", "'endpoints'"],
  ['connect bot', 'connect endpoint'],
  ['Connect bot', 'Connect endpoint'],
  ['connectBot', 'connectEndpoint'],
  ['Bot 接口', 'Endpoint 接口'],
  ['Bot 实例', 'Endpoint 实例'],
  ['Bot 掉线', 'Endpoint 掉线'],
  ['Bot 连接', 'Endpoint 连接'],
  ['Bot 级', 'Endpoint 级'],
  ['Bot 按', 'Endpoint 按'],
  ['Bot IO', 'Endpoint IO'],
  ['Bot Capability', 'Endpoint Capability'],
  ['platform Bot', 'platform Endpoint'],
  ['平台 Bot', '平台 Endpoint'],
  ['各 Bot', '各 Endpoint'],
  ['所有 Bot', '所有 Endpoint'],
  ['单个 bot', '单个 endpoint'],
  ['多个 bot', '多个 endpoint'],
  ['bot 实例', 'endpoint 实例'],
  ['bot 连接', 'endpoint 连接'],
  ['bot 掉了', 'endpoint 掉了'],
  ['纯出站 bot', '纯出站 endpoint'],
  ['纯入站 bot', '纯入站 endpoint'],
  ['双向 bot', '双向 endpoint'],
  ['outbound-only bot', 'outbound-only endpoint'],
  ['inbound-only bot', 'inbound-only endpoint'],
  ['Bot not found', 'Endpoint not found'],
  ['bot not found', 'endpoint not found'],
  ['options.bot', 'options.endpoint'],
  ['message.$bot', 'message.$endpoint'],
  ['commMessage.$bot', 'commMessage.$endpoint'],
  ['readBotConfig', 'readEndpointConfig'],
  ['BotConfigRoles', 'EndpointConfigRoles'],
  ['collectBotTrustedIds', 'collectEndpointTrustedIds'],
  ['resolveSandboxBot', 'resolveSandboxEndpoint'],
  ['SandboxAdapter', 'SandboxAdapter'],
  ['botFactory', 'endpointFactory'],
  ['bot-ws-server', 'endpoint-ws-server'],
  ['bot-ws-client', 'endpoint-ws-client'],
  ['bot-ws.ts', 'endpoint-ws.ts'],
  ['bot-wss.ts', 'endpoint-wss.ts'],
  ['bot-webhook.ts', 'endpoint-webhook.ts'],
  ['bot-http.ts', 'endpoint-http.ts'],
  ['bot-base.ts', 'endpoint-base.ts'],
  ['bot-interactions.ts', 'endpoint-interactions.ts'],
  ['bot-sse.ts', 'endpoint-sse.ts'],
  ['/bot.ts', '/endpoint.ts'],
];

const FILE_RENAMES = [
  ['packages/im/core/src/bot.ts', 'packages/im/core/src/endpoint.ts'],
  ['packages/im/core/src/bot-capabilities.ts', 'packages/im/core/src/endpoint-capabilities.ts'],
  ['packages/im/core/src/built/connect-bot-instance.ts', 'packages/im/core/src/built/connect-endpoint-instance.ts'],
  ['packages/im/core/src/built/bot-lifecycle.ts', 'packages/im/core/src/built/endpoint-lifecycle.ts'],
  ['packages/im/zhin/src/setup/connect-bots.ts', 'packages/im/zhin/src/setup/connect-endpoints.ts'],
  ['packages/im/core/tests/bot-capabilities.test.ts', 'packages/im/core/tests/endpoint-capabilities.test.ts'],
  ['packages/im/core/tests/bot-lifecycle.test.ts', 'packages/im/core/tests/endpoint-lifecycle.test.ts'],
  ['packages/im/core/tests/bot.test.ts', 'packages/im/core/tests/endpoint.test.ts'],
  ['packages/host/api/src/bot-hub.ts', 'packages/host/api/src/endpoint-hub.ts'],
  ['packages/host/api/src/bot-persistence.ts', 'packages/host/api/src/endpoint-persistence.ts'],
  ['packages/host/api/src/bot-db-models.ts', 'packages/host/api/src/endpoint-db-models.ts'],
  ['packages/host/api/docs/BOT_MANAGEMENT_FEATURES.md', 'packages/host/api/docs/ENDPOINT_MANAGEMENT_FEATURES.md'],
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
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(path.basename(file))) return false;
  if (rel.includes('node_modules')) return false;
  const ext = path.extname(file);
  return ['.ts', '.tsx', '.md', '.mdc', '.yml', '.yaml', '.json', '.mjs', '.js'].includes(ext);
}

function applyReplacements(content) {
  let out = content;
  for (const [from, to] of REPLACEMENTS) {
    if (from === to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

// Adapter bot.ts files
const adapterBotFiles = walk(path.join(ROOT, 'plugins/adapters')).filter(
  (f) => path.basename(f) === 'bot.ts' || /^bot-/.test(path.basename(f)),
);

for (const f of adapterBotFiles) {
  const dir = path.dirname(f);
  const base = path.basename(f);
  let newBase = base;
  if (base === 'bot.ts') newBase = 'endpoint.ts';
  else newBase = base.replace(/^bot-/, 'endpoint-');
  if (newBase !== base) {
    FILE_RENAMES.push([path.relative(ROOT, f), path.join(path.relative(ROOT, dir), newBase)]);
  }
}

// Phase 1: content
const allFiles = walk(ROOT).filter(shouldProcess);
let changed = 0;
for (const file of allFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  const next = applyReplacements(raw);
  if (next !== raw) {
    fs.writeFileSync(file, next);
    changed++;
  }
}
console.log(`Updated ${changed} files`);

// Phase 2: renames (deepest first)
const renames = [...new Set(FILE_RENAMES.map(([a, b]) => JSON.stringify([a, b])))]
  .map((s) => JSON.parse(s))
  .sort((a, b) => b[0].length - a[0].length);

for (const [fromRel, toRel] of renames) {
  const from = path.join(ROOT, fromRel);
  const to = path.join(ROOT, toRel);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  console.log(`Renamed ${fromRel} → ${toRel}`);
}

console.log('Done');
