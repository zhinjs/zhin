import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stringify } from 'yaml';
import { additionalPlatforms, buildAdditionalProfile } from './additional-profiles.mjs';
import { validatePolicy, durationMs } from '../../scripts/platform-acceptance/report.mjs';

const home = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(home, '../..');
const platforms = ['napcat', 'onebot11', 'qq', 'telegram', ...additionalPlatforms];
const variable = name => '${' + name + '}';
const defaultModeFor = platform => ({ discord: 'gateway', slack: 'socket', kook: 'websocket', email: 'smtp-imap', lark: 'websocket', dingtalk: 'stream', line: 'webhook' })[platform] || (platform === 'telegram' ? 'polling' : platform === 'qq' ? 'websocket' : 'ws');
const profileName = (platform, environment) => {
  const mode = environment[`${platform.toUpperCase()}_MODE`]?.trim() || defaultModeFor(platform);
  return mode === defaultModeFor(platform) ? platform : `${platform}-${mode}`;
};

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`请在 .env 填写 ${name}`);
  return value;
}
function integer(environment, name, fallback, minimum) {
  const value = Number(environment[name]?.trim() || fallback);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`.env 中的 ${name} 必须是 >= ${minimum} 的整数`);
  return value;
}

export async function prepareProject(platform, environment, destination = home, buildOnly = false) {
  if (!platforms.includes(platform)) throw new Error(`平台必须是 ${platforms.join('、')}`);
  const prefix = platform.toUpperCase();
  const chatId = required(environment, `${prefix}_TEST_CHAT_ID`);
  const additional = additionalPlatforms.includes(platform) ? buildAdditionalProfile(platform, environment) : undefined;
  const kind = environment[`${prefix}_TEST_CHAT_KIND`]?.trim() || additional?.defaultKind || 'private';
  const endpoint = { id: 'test-bot' };
  const defaultMode = defaultModeFor(platform);
  const mode = environment[`${prefix}_MODE`]?.trim() || defaultMode;
  const modes = additional ? [additional.mode] : platform === 'telegram' ? ['polling', 'webhook'] : platform === 'qq' ? ['websocket', 'webhook', 'middleware'] : platform === 'napcat' ? ['ws', 'wss', 'http'] : ['ws', 'wss'];
  if (!modes.includes(mode)) throw new Error(`${prefix}_MODE 只能填写 ${modes.join('、')}`);
  const inboundHttp = ['wss', 'http', 'webhook', 'middleware'].includes(mode);
  const listenerPath = name => {
    const value = required(environment, name);
    if (!value.startsWith('/') || value.includes('?') || value.includes('#')) throw new Error(`${name} 必须是以 / 开头、不含查询参数的路径`);
    return value;
  };
  const validateUrl = (name, protocols) => {
    try { if (!protocols.includes(new URL(required(environment, name)).protocol)) throw new Error(); } catch { throw new Error(`${name} 地址协议必须是 ${protocols.join(' 或 ')}`); }
  };
  const httpPort = environment.ACCEPTANCE_HTTP_PORT?.trim() || inboundHttp
    ? integer(environment, 'ACCEPTANCE_HTTP_PORT', 18080, 1) : 0;
  if (httpPort > 65535) throw new Error('ACCEPTANCE_HTTP_PORT 必须 <= 65535');
  let instance;
  let bridge;
  if (additional) {
    instance = additional.instance;
  } else if (platform === 'telegram') {
    required(environment, 'TELEGRAM_BOT_TOKEN');
    const webhook = mode === 'webhook' ? {
      domain: variable('TELEGRAM_WEBHOOK_DOMAIN'), path: listenerPath('TELEGRAM_WEBHOOK_PATH'), secretToken: variable('TELEGRAM_WEBHOOK_SECRET'),
    } : undefined;
    if (webhook) { validateUrl('TELEGRAM_WEBHOOK_DOMAIN', ['https:']); required(environment, 'TELEGRAM_WEBHOOK_SECRET'); }
    const apiBaseUrl = environment.TELEGRAM_API_BASE_URL?.trim();
    if (apiBaseUrl) validateUrl('TELEGRAM_API_BASE_URL', ['http:', 'https:']);
    instance = { polling: mode === 'polling', ...(webhook ? { webhook } : {}), endpoints: [{ ...endpoint, token: variable('TELEGRAM_BOT_TOKEN'), ...(apiBaseUrl ? { apiBaseUrl: variable('TELEGRAM_API_BASE_URL') } : {}) }] };
  } else if (platform === 'qq') {
    required(environment, 'QQ_APP_ID');
    required(environment, 'QQ_APP_SECRET');
    const sandbox = environment.QQ_SANDBOX?.trim() || 'true';
    if (!['true', 'false'].includes(sandbox)) throw new Error('QQ_SANDBOX 只能填写 true 或 false');
    const botKind = environment.QQ_BOT_KIND?.trim() || 'public';
    if (!['public', 'private'].includes(botKind)) throw new Error('QQ_BOT_KIND 只能填写 public 或 private');
    instance = { mode, ...(mode !== 'websocket' ? { webhookPath: listenerPath('QQ_WEBHOOK_PATH') } : {}), endpoints: [{ ...endpoint, appid: variable('QQ_APP_ID'), secret: variable('QQ_APP_SECRET'), sandbox: sandbox === 'true', botKind }] };
    if (environment.QQ_STREAM_PROXY_PORT?.trim() || environment.QQ_STREAM_PROXY_SERVER_NAME?.trim()) {
      if (mode !== 'websocket') throw new Error('QQ Stream 代理仅用于 websocket 模式');
      const proxyPort = integer(environment, 'QQ_STREAM_PROXY_PORT', 0, 1);
      if (proxyPort > 65535) throw new Error('QQ_STREAM_PROXY_PORT 必须 <= 65535');
      required(environment, 'QQ_STREAM_PROXY_SERVER_NAME');
      instance.endpoints[0].streamProxy = { port: proxyPort, serverName: variable('QQ_STREAM_PROXY_SERVER_NAME') };
    }
  } else {
    bridge = { name: environment[`${prefix}_BRIDGE_NAME`]?.trim() || platform, version: required(environment, `${prefix}_BRIDGE_VERSION`) };
    let transport;
    if (mode === 'ws') {
      validateUrl(`${prefix}_WS_URL`, ['ws:', 'wss:']);
      transport = { url: variable(`${prefix}_WS_URL`) };
    } else if (mode === 'wss') {
      transport = { path: listenerPath(`${prefix}_REVERSE_WS_PATH`) };
    } else {
      validateUrl('NAPCAT_HTTP_URL', ['http:', 'https:']);
      transport = { http_url: variable('NAPCAT_HTTP_URL'), post_path: listenerPath('NAPCAT_POST_PATH') };
    }
    instance = { connection: mode, endpoints: [{ ...endpoint, ...transport, access_token: variable(`${prefix}_ACCESS_TOKEN`) }] };
  }
  instance.commandPrefix = environment[`${prefix}_COMMAND_PREFIX`]?.trim() || (platform === 'slack' ? '!' : '/');
  if (buildOnly) return { instance, kind, chatId, mode };
  const targets = [{ alias: `${platform}-a`, adapter: `root/${platform}`, endpoint: 'test-bot', kind, id: chatId }];
  if (environment[`${prefix}_B_TEST_CHAT_ID`]?.trim()) {
    const secondaryEnvironment = { ...environment };
    // Account B must not silently borrow account A's credentials or listener path.
    for (const name of Object.keys(secondaryEnvironment)) {
      if (name.startsWith(`${prefix}_`) && !name.startsWith(`${prefix}_B_`)) delete secondaryEnvironment[name];
    }
    for (const [name, value] of Object.entries(environment)) {
      if (name.startsWith(`${prefix}_B_`)) secondaryEnvironment[name.replace(`${prefix}_B_`, `${prefix}_`)] = value;
    }
    secondaryEnvironment[`${prefix}_MODE`] = mode;
    let secondary;
    try { secondary = await prepareProject(platform, secondaryEnvironment, destination, true); }
    catch (error) { throw new Error(error.message.replaceAll(prefix + '_', prefix + '_B_')); }
    const primaryEndpoint = instance.endpoints[0];
    const secondaryEndpoint = { ...secondary.instance, ...secondary.instance.endpoints[0], id: 'test-bot-b' };
    delete secondaryEndpoint.endpoints;
    delete secondaryEndpoint.commandPrefix;
    const rewrite = value => typeof value === 'string' ? value.replaceAll('${' + prefix + '_', '${' + prefix + '_B_') : Array.isArray(value) ? value.map(rewrite) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value;
    const rewritten = rewrite(secondaryEndpoint);
    const primaryPath = primaryEndpoint.path ?? primaryEndpoint.post_path ?? instance.webhookPath ?? instance.webhook?.path;
    const secondaryPath = rewritten.path ?? rewritten.post_path ?? rewritten.webhookPath ?? rewritten.webhook?.path;
    if (inboundHttp && primaryPath === secondaryPath) throw new Error(`${prefix}_B 的入站路径必须与账号 A 不同`);
    instance.endpoints.push(rewritten);
    targets.push({ alias: `${platform}-b`, adapter: `root/${platform}`, endpoint: 'test-bot-b', kind: secondary.kind, id: secondary.chatId });
  }

  const directory = path.join(destination, '.acceptance', profileName(platform, environment));
  const project = path.join(directory, 'project');
  const policyPath = path.join(directory, 'policy.json');
  const policy = validatePolicy({
    version: 1, platform, mode,
    targets,
    actions: (environment.ACCEPTANCE_ACTIONS || 'reply-text').split(',').map(value => value.trim()).filter(Boolean),
    minIntervalMs: integer(environment, 'ACCEPTANCE_MIN_INTERVAL_MS', 5000, 1000),
    maxSends: integer(environment, 'ACCEPTANCE_MAX_SENDS', 1000, 1),
    eventsPath: path.join(directory, 'events.jsonl'),
    soak: { minConfirmed: integer(environment, 'ACCEPTANCE_SOAK_MIN_CONFIRMED', 96, 1), maxGapMs: integer(environment, 'ACCEPTANCE_SOAK_MAX_GAP_MS', 900000, 1000), maxRssGrowthBytes: integer(environment, 'ACCEPTANCE_SOAK_MAX_RSS_GROWTH_BYTES', 33554432, 0) },
    ...(bridge ? { bridge } : {}),
  });
  await mkdir(path.join(project, 'commands/acceptance'), { recursive: true, mode: 0o700 });
  await mkdir(path.join(directory, 'reports'), { recursive: true, mode: 0o700 });
  const sourceManifest = JSON.parse(await readFile(path.join(home, 'package.json'), 'utf8'));
  const manifest = {
    name: `platform-acceptance-${platform}`, private: true, version: '0.0.0', type: 'module',
    dependencies: { 'zhin.js': 'workspace:*', [`@zhin.js/adapter-${platform}`]: 'workspace:*' },
    zhin: { ...sourceManifest.zhin, plugins: [{ package: `@zhin.js/adapter-${platform}`, instanceKey: platform }] },
  };
  await writeFile(path.join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await copyFile(path.join(home, 'plugin.ts'), path.join(project, 'plugin.ts'));
  await copyFile(path.join(home, 'commands/acceptance/index.ts'), path.join(project, 'commands/acceptance/index.ts'));
  await writeFile(path.join(project, 'zhin.config.yml'), stringify({
    log_level: targets.some(target => target.id === 'pending') ? 'debug' : 'info', plugin: {}, plugins: { [platform]: instance },
    http: { host: environment.ACCEPTANCE_HTTP_HOST?.trim() || '127.0.0.1', port: httpPort, readiness: { endpoints: targets.map(target => ({ owner: `root/${platform}`, name: `${platform}~${target.endpoint}` })) } },
  }), { mode: 0o600 });
  await writeFile(policyPath, JSON.stringify(policy, null, 2) + '\n', { mode: 0o600 });
  return { project, policyPath, policy, directory };
}

async function launch(script, args, cwd, environment) {
  const child = spawn(process.execPath, [script, ...args], { cwd, env: environment, stdio: 'inherit' });
  const onInterrupt = () => child.kill('SIGINT');
  const onTerminate = () => child.kill('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);
  try {
    return await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(signal ? 0 : code ?? 1)); });
  } finally {
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

async function main() {
  const [action, platform, duration = '30s'] = process.argv.slice(2);
  if (!['prepare', 'dev', 'start', 'observe'].includes(action) || !platforms.includes(platform)) throw new Error(`用法：node run.mjs prepare|dev|start|observe ${platforms.join('|')} [30s|24h|72h]`);
  try { process.loadEnvFile(path.join(home, '.env')); } catch (error) { if (error.code === 'ENOENT') throw new Error('请先把 .env.example 复制为 .env 并填写'); throw new Error('无法读取 .env'); }
  const environment = { ...process.env };
  // Empty bridge tokens are valid for bridges without access-token authentication.
  for (const bridge of ['NAPCAT', 'ONEBOT11']) { environment[`${bridge}_ACCESS_TOKEN`] ??= ''; environment[`${bridge}_B_ACCESS_TOKEN`] ??= ''; }
  if (action === 'observe') durationMs(duration);
  const directory = path.join(home, '.acceptance', profileName(platform, environment));
  let prepared;
  if (action === 'observe') {
    const policyPath = path.join(directory, 'policy.json');
    let policy;
    try { policy = validatePolicy(JSON.parse(await readFile(policyPath, 'utf8'))); } catch { throw new Error('请先使用对应的 dev/start 命令启动测试项目，再开始观察'); }
    prepared = { directory, project: path.join(directory, 'project'), policyPath, policy };
  } else {
    prepared = await prepareProject(platform, environment);
  }
  environment.ZHIN_ACCEPTANCE_POLICY = prepared.policyPath;
  delete environment.ZHIN_RUNTIME_CHILD;
  if (action === 'prepare') { console.log(`${platform} 配置与白名单已生成；未连接平台。`); return; }
  if (action === 'dev' || action === 'start') {
    if (prepared.policy.targets.some(target => target.id === 'pending')) {
      console.log(`启动 ${platform} 的会话 ID 获取模式（debug 日志）。请向自己的 Bot 发送 /start，读取 receive/recv 中的会话 ID 后填写 .env 并重启；此时探针不会回复。`);
    } else {
      const prefix = environment[`${platform.toUpperCase()}_COMMAND_PREFIX`]?.trim() || (platform === 'slack' ? '!' : '/');
      console.log(`启动 ${platform}，仅接受白名单探针。请发送 ${prefix}acceptance probe:sample0001`);
    }
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('@zhin.js/cli'))), '../bin/zhin.js');
    process.exitCode = await launch(cli, ['runtime', 'start', ...(action === 'start' ? ['--mode', 'production', '--no-watch'] : [])], prepared.project, environment);
    return;
  }
  const reportPath = path.join(prepared.directory, 'reports', `${new Date().toISOString().replaceAll(':', '-')}.json`);
  const args = ['--project', prepared.project, '--policy', prepared.policyPath, '--report', reportPath, '--duration', duration];
  if (durationMs(duration) >= 86400000) {
    let records;
    try { records = (await readFile(prepared.policy.eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch { throw new Error('长跑前请先发送一次成功的文本探针，以确定实际运行时 PID'); }
    const pid = records.findLast(record => record.result === 'confirmed' && Number.isInteger(record.pid))?.pid;
    if (!pid) throw new Error('长跑前请先发送一次成功的文本探针，以确定实际运行时 PID');
    try { process.kill(pid, 0); } catch { throw new Error('上次探针对应的运行时已退出；请重新启动并发送成功探针'); }
    args.push('--pid', String(pid));
  }
  process.exitCode = await launch(path.join(repo, 'scripts/platform-acceptance/run.mjs'), args, repo, environment);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
