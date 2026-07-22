import inquirer from 'inquirer';
import chalk from 'chalk';
import { IlinkQrLoginError, loginWithIlinkQr } from './weixin-ilink-login.js';

/** 平台适配器文档索引 */
export const ADAPTERS_DOCS_URL = 'https://zhin.js.org/adapters/';

/** @deprecated 使用 ADAPTERS_DOCS_URL */
export const ADAPTERS_INDEX_URL = ADAPTERS_DOCS_URL;

/** 框架级适配器概念（多平台、群管工具等） */
export const ADAPTERS_ESSENTIALS_URL = 'https://zhin.js.org/essentials/adapters';

/** 各适配器文档页（与 docs/adapters/*.md 同步） */
export const adapterDocsUrl = (slug: string) => `https://zhin.js.org/adapters/${slug}`;

export interface EndpointConfigureContext {
  envVars: Record<string, string>;
  markRequiresDatabase: () => void;
}

export async function configureTelegramEndpoint(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('telegram')));

  const { endpointName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'telegram-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: '  Telegram Endpoint Token（@BotFather 获取）:',
      validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
    },
  ]);
  ctx.envVars.TELEGRAM_TOKEN = token;

  const { transport } = await inquirer.prompt([
    {
      type: 'select',
      name: 'transport',
      message: '  消息接收方式:',
      choices: [
        {
          name: '长轮询 polling（默认，本地开发无需公网）',
          value: 'polling',
        },
        {
          name: 'Webhook（生产环境，需 HTTPS 公网域名）',
          value: 'webhook',
        },
      ],
      default: 'polling',
    },
  ]);

  // schema：polling / webhook 为顶层共享字段；name / token 为 endpoint 级
  const config: Record<string, unknown> = {
    polling: transport === 'polling',
    endpoints: [{ name: endpointName.trim(), token: '${TELEGRAM_TOKEN}' }],
  };

  if (transport === 'webhook') {
    console.log('');
    console.log(chalk.yellow('     Webhook 前置条件：'));
    console.log(chalk.gray('     • Endpoint 进程需绑定可被 Telegram 访问的 HTTPS 域名（有效 TLS 证书）'));
    console.log(chalk.gray('     • Webhook 由内置 HTTP Host（zhin runtime start）承接，防火墙/反向代理需放行 http 端口'));

    const webhook = await inquirer.prompt([
      {
        type: 'input',
        name: 'domain',
        message: '  Webhook 公网 HTTPS 域名（如 https://bot.example.com）:',
        validate: (v: string) => {
          if (!v.trim()) return '域名不能为空';
          if (!/^https:\/\/.+/i.test(v.trim())) return '须以 https:// 开头';
          return true;
        },
      },
      {
        type: 'input',
        name: 'path',
        message: '  Webhook 路径:',
        default: '/telegram/webhook',
      },
    ]);

    config.polling = false;
    config.webhook = {
      domain: webhook.domain.trim(),
      path: webhook.path.trim(),
    };
  }

  return config;
}

export async function configureGitHubEndpoint(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('github')));
  ctx.markRequiresDatabase();

  const { endpointName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'github-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  const { authMode } = await inquirer.prompt([
    {
      type: 'select',
      name: 'authMode',
      message: '  认证方式:',
      choices: [
        {
          name: 'GitHub App（推荐生产：JWT → Installation Token）',
          value: 'github_app',
        },
        {
          name: 'gh CLI（本地开发：需 gh auth login）',
          value: 'gh_cli',
        },
      ],
      default: 'github_app',
    },
  ]);

  // schema：app_id / private_key / webhook_secret 为 endpoint 级；webhook_path / poll_interval 为顶层共享字段
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
  };
  const sharedConfig: Record<string, unknown> = {};

  if (authMode === 'github_app') {
    console.log(chalk.gray('     在 github.com/settings/apps 创建 App，记录 App ID 并下载 .pem 私钥'));

    const appConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'app_id',
        message: '  GitHub App ID:',
        validate: (v: string) => (v.trim() ? true : 'App ID 不能为空'),
      },
      {
        type: 'input',
        name: 'private_key',
        message: '  私钥路径或 PEM 内容（如 ./data/github-app.pem）:',
        default: './data/github-app.pem',
        validate: (v: string) => (v.trim() ? true : '私钥不能为空'),
      },
    ]);

    ctx.envVars.GITHUB_APP_ID = appConfig.app_id.trim();
    endpointConfig.app_id = '${GITHUB_APP_ID}';
    endpointConfig.private_key = appConfig.private_key.trim();
  } else {
    console.log(chalk.gray('     请确保已执行 gh auth login，且 gh 在 PATH 中'));
  }

  const { eventsMode } = await inquirer.prompt([
    {
      type: 'select',
      name: 'eventsMode',
      message: '  事件接收方式:',
      choices: [
        {
          name: 'Webhook 实时推送（由内置 HTTP Host 承接，需公网 URL）',
          value: 'webhook',
        },
        {
          name: '轮询 polling（无需公网，默认 60s 间隔）',
          value: 'polling',
        },
      ],
      default: 'webhook',
    },
  ]);

  if (eventsMode === 'webhook') {
    console.log('');
    console.log(chalk.yellow('     Webhook 前置条件：'));
    console.log(chalk.gray('     • Webhook 由内置 HTTP Host（zhin runtime start 的 http 配置）承接'));
    console.log(chalk.gray('     • GitHub App Webhook URL 填 https://<你的域名>/github/webhook'));

    const webhook = await inquirer.prompt([
      {
        type: 'password',
        name: 'webhook_secret',
        message: '  Webhook Secret（与 GitHub App 设置一致）:',
        validate: (v: string) => (v.trim() ? true : 'Webhook 模式需填写 Secret'),
      },
      {
        type: 'input',
        name: 'webhook_path',
        message: '  Webhook 路径:',
        default: '/github/webhook',
      },
    ]);

    ctx.envVars.GITHUB_WEBHOOK_SECRET = webhook.webhook_secret;
    endpointConfig.webhook_secret = '${GITHUB_WEBHOOK_SECRET}';
    sharedConfig.webhook_path = webhook.webhook_path.trim();
  } else {
    const { poll_interval } = await inquirer.prompt([
      {
        type: 'input',
        name: 'poll_interval',
        message: '  轮询间隔（秒）:',
        default: '60',
        validate: (v: string) => {
          const n = parseInt(v, 10);
          if (Number.isNaN(n) || n < 10) return '建议不小于 10 秒';
          return true;
        },
      },
    ]);
    sharedConfig.poll_interval = parseInt(poll_interval, 10);
  }

  const { enableMcp } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableMcp',
      message: '  配置 server-github MCP PAT？（可选，用于 fork 等 MCP 工具）',
      default: false,
    },
  ]);

  if (enableMcp) {
    const { pat } = await inquirer.prompt([
      {
        type: 'password',
        name: 'pat',
        message: '  GitHub Personal Access Token:',
        validate: (v: string) => (v.trim() ? true : 'PAT 不能为空'),
      },
    ]);
    ctx.envVars.GITHUB_PERSONAL_ACCESS_TOKEN = pat;
  }

  return { ...sharedConfig, endpoints: [endpointConfig] };
}

export async function configureOneBot11Bot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('onebot11')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: '正向 WebSocket (ws) — 本 Endpoint 连接 OneBot 实现', value: 'ws' },
        { name: '反向 WebSocket (wss) — OneBot 实现连本 Bot（由内置 HTTP Host 承接）', value: 'wss' },
      ],
      default: 'ws',
    },
  ]);

  const { endpointName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'onebot-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  // schema：connection 为顶层共享字段；name / url / path / access_token 为 endpoint 级
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
  };

  if (connection === 'ws') {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: '  OneBot WS 地址:',
        default: 'ws://127.0.0.1:6700',
        validate: (v: string) => (v.trim() ? true : '地址不能为空'),
      },
    ]);
    endpointConfig.url = url.trim();
  } else {
    console.log(chalk.gray('     反向 WS 由内置 HTTP Host 承接，OneBot 实现配置连接到此 Bot'));
    const { path: wsPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '  反向 WS 路径:',
        default: '/onebot11/ws',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    endpointConfig.path = wsPath.trim();
  }

  const { accessToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'accessToken',
      message: '  access_token（无则留空）:',
      default: '',
    },
  ]);
  if (accessToken?.trim()) {
    ctx.envVars.ONEBOT11_ACCESS_TOKEN = accessToken.trim();
    endpointConfig.access_token = '${ONEBOT11_ACCESS_TOKEN}';
  }

  return { connection, endpoints: [endpointConfig] };
}

export async function configureQQBot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('qq')));

  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: '  Endpoint 标识名称:',
      default: 'qq-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'input',
      name: 'appID',
      message: '  App ID（QQ 开放平台）:',
      validate: (v: string) => (v.trim() ? true : 'App ID 不能为空'),
    },
    {
      type: 'password',
      name: 'secret',
      message: '  Secret:',
      validate: (v: string) => (v.trim() ? true : 'Secret 不能为空'),
    },
  ]);

  ctx.envVars.QQ_APP_ID = credentials.appID.trim();
  ctx.envVars.QQ_SECRET = credentials.secret;

  const { mode, sandbox } = await inquirer.prompt([
    {
      type: 'select',
      name: 'mode',
      message: '  消息接收模式 (mode):',
      choices: [
        { name: 'websocket — WebSocket 网关（默认，无需公网）', value: 'websocket' },
        { name: 'webhook — HTTP 回调（需公网可达的内置 HTTP Host）', value: 'webhook' },
      ],
      default: 'websocket',
    },
    {
      type: 'confirm',
      name: 'sandbox',
      message: '  沙箱环境 (sandbox)?',
      default: false,
    },
  ]);

  // schema：mode / sandbox 为顶层共享字段；name / appid / secret 为 endpoint 级
  return {
    mode,
    sandbox,
    endpoints: [{
      name: credentials.name.trim(),
      appid: '${QQ_APP_ID}',
      secret: '${QQ_SECRET}',
    }],
  };
}

export async function configureDiscordEndpoint(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('discord')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: 'Gateway WebSocket（常规 Bot，推荐）', value: 'gateway' },
        { name: 'Interactions HTTP（斜杠命令，需 host-router）', value: 'interactions' },
      ],
      default: 'gateway',
    },
  ]);

  const { endpointName, token } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'discord-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'password',
      name: 'token',
      message: '  Endpoint Token:',
      validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
    },
  ]);
  ctx.envVars.DISCORD_TOKEN = token;

  // schema：connection / applicationId / publicKey / interactionsPath 为顶层共享字段；name / token 为 endpoint 级
  const config: Record<string, unknown> = {
    connection,
    endpoints: [{ name: endpointName.trim(), token: '${DISCORD_TOKEN}' }],
  };

  if (connection === 'interactions') {
    console.log(chalk.gray('     Interactions 模式由内置 HTTP Host 承接，需 Developer Portal 中的公钥'));
    const interactions = await inquirer.prompt([
      {
        type: 'input',
        name: 'applicationId',
        message: '  Application ID:',
        validate: (v: string) => (v.trim() ? true : '不能为空'),
      },
      {
        type: 'input',
        name: 'publicKey',
        message: '  Public Key:',
        validate: (v: string) => (v.trim() ? true : '不能为空'),
      },
      {
        type: 'input',
        name: 'interactionsPath',
        message: '  Interactions 路径:',
        default: '/discord/interactions',
      },
    ]);
    config.applicationId = interactions.applicationId.trim();
    config.publicKey = interactions.publicKey.trim();
    config.interactionsPath = interactions.interactionsPath.trim();
  }

  return config;
}

export async function configureSlackEndpoint(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('slack')));

  const { socketMode } = await inquirer.prompt([
    {
      type: 'select',
      name: 'socketMode',
      message: '  连接方式:',
      choices: [
        { name: 'Socket Mode（无需公网，需 App Token）', value: 'true' },
        { name: 'HTTP Events API（需公网 URL + 端口）', value: 'false' },
      ],
      default: 'true',
    },
  ]);

  const { endpointName, token, signingSecret } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'slack-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'password',
      name: 'token',
      message: '  Endpoint Token (xoxb-...):',
      validate: (v: string) => (v.trim() ? true : '不能为空'),
    },
    {
      type: 'password',
      name: 'signingSecret',
      message: '  Signing Secret:',
      validate: (v: string) => (v.trim() ? true : '不能为空'),
    },
  ]);

  ctx.envVars.SLACK_BOT_TOKEN = token;
  ctx.envVars.SLACK_SIGNING_SECRET = signingSecret;

  // schema：socketMode 为顶层共享字段；name / token / signingSecret / appToken 为 endpoint 级
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
    token: '${SLACK_BOT_TOKEN}',
    signingSecret: '${SLACK_SIGNING_SECRET}',
  };

  if (socketMode === 'true') {
    const { appToken } = await inquirer.prompt([
      {
        type: 'password',
        name: 'appToken',
        message: '  App Token (xapp-...，Socket Mode 必需):',
        validate: (v: string) => (v.trim() ? true : 'App Token 不能为空'),
      },
    ]);
    ctx.envVars.SLACK_APP_TOKEN = appToken;
    endpointConfig.appToken = '${SLACK_APP_TOKEN}';
  } else {
    console.log(chalk.yellow('     HTTP 模式由内置 HTTP Host 承接，需公网可达并配置 Slack Event Subscriptions URL'));
  }

  return { socketMode: socketMode === 'true', endpoints: [endpointConfig] };
}

export async function configureNapcatBot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('napcat')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: '正向 WebSocket (ws) — 本 Bot 连接 NapCat', value: 'ws' },
        { name: '反向 WebSocket (wss) — NapCat 连本 Bot（由内置 HTTP Host 承接）', value: 'wss' },
        { name: 'HTTP (http) — POST 上报入站 + HTTP API 出站（由内置 HTTP Host 承接）', value: 'http' },
      ],
      default: 'ws',
    },
  ]);

  const { endpointName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'napcat-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  // schema：connection 为顶层共享字段；name / url / path / http_url / post_path / access_token 为 endpoint 级
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
  };

  if (connection === 'ws') {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: '  NapCat WS 地址:',
        default: 'ws://127.0.0.1:3001',
        validate: (v: string) => (v.trim() ? true : '地址不能为空'),
      },
    ]);
    endpointConfig.url = url.trim();
  } else if (connection === 'wss') {
    console.log(chalk.gray('     反向 WS 由内置 HTTP Host 承接，NapCat 配置连接到此 Bot'));
    const { path: wsPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '  反向 WS 路径:',
        default: '/napcat/ws',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    endpointConfig.path = wsPath.trim();
  } else {
    const http = await inquirer.prompt([
      {
        type: 'input',
        name: 'http_url',
        message: '  NapCat HTTP API 地址（出站）:',
        default: 'http://127.0.0.1:3000',
        validate: (v: string) => (v.trim() ? true : '地址不能为空'),
      },
      {
        type: 'input',
        name: 'post_path',
        message: '  HTTP POST 上报路径（入站）:',
        default: '/napcat/post',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    endpointConfig.http_url = http.http_url.trim();
    endpointConfig.post_path = http.post_path.trim();
  }

  const { accessToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'accessToken',
      message: '  access_token（无则留空）:',
      default: '',
    },
  ]);
  if (accessToken?.trim()) {
    ctx.envVars.NAPCAT_TOKEN = accessToken.trim();
    endpointConfig.access_token = '${NAPCAT_TOKEN}';
  }

  return { connection, endpoints: [endpointConfig] };
}

export async function configureOneBot12Bot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('onebot12')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: '正向 WebSocket (ws) — 本 Bot 连接 OneBot 实现', value: 'ws' },
        { name: 'HTTP Webhook (webhook) — POST 入站 + api_url HTTP 出站（由内置 HTTP Host 承接）', value: 'webhook' },
        { name: '反向 WebSocket (wss) — OneBot 实现连本 Bot（由内置 HTTP Host 承接）', value: 'wss' },
      ],
      default: 'ws',
    },
  ]);

  const { endpointName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'onebot12-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  // schema：connection 为顶层共享字段；name / url / path / api_url / access_token 为 endpoint 级
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
  };

  if (connection === 'ws') {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: '  OneBot WS 地址:',
        default: 'ws://127.0.0.1:6700',
        validate: (v: string) => (v.trim() ? true : '地址不能为空'),
      },
    ]);
    endpointConfig.url = url.trim();
  } else if (connection === 'webhook') {
    const webhook = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '  Webhook POST 路径（入站）:',
        default: '/onebot12/webhook',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
      {
        type: 'input',
        name: 'api_url',
        message: '  HTTP action 地址（出站）:',
        default: 'http://127.0.0.1:6700',
        validate: (v: string) => (v.trim() ? true : '地址不能为空'),
      },
    ]);
    endpointConfig.path = webhook.path.trim();
    endpointConfig.api_url = webhook.api_url.trim();
  } else {
    console.log(chalk.gray('     反向 WS 由内置 HTTP Host 承接，OneBot 实现配置连接到此 Bot'));
    const { path: wsPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '  反向 WS 路径:',
        default: '/onebot12/ws',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    endpointConfig.path = wsPath.trim();
  }

  const { accessToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'accessToken',
      message: '  access_token（无则留空）:',
      default: '',
    },
  ]);
  if (accessToken?.trim()) {
    ctx.envVars.ONEBOT12_ACCESS_TOKEN = accessToken.trim();
    endpointConfig.access_token = '${ONEBOT12_ACCESS_TOKEN}';
  }

  return { connection, endpoints: [endpointConfig] };
}

export async function configureMilkyBot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('milky')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: '正向 WebSocket (ws) — 本 Bot 连协议端 ws(s)://baseUrl/event', value: 'ws' },
        { name: 'SSE (sse) — HTTP GET baseUrl/event（text/event-stream）', value: 'sse' },
        { name: 'Webhook (webhook) — POST 入站 + baseUrl HTTP API 出站（由内置 HTTP Host 承接）', value: 'webhook' },
        { name: '反向 WebSocket (wss) — 由内置 HTTP Host 承接', value: 'wss' },
      ],
      default: 'ws',
    },
  ]);

  const { endpointName, baseUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'milky-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: '  Milky HTTP API baseUrl:',
      default: 'http://127.0.0.1:8080',
      validate: (v: string) => (v.trim() ? true : 'baseUrl 不能为空'),
    },
  ]);

  // schema：connection 为顶层共享字段；name / baseUrl / path / access_token 为 endpoint 级
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
    baseUrl: baseUrl.trim(),
  };

  if (connection === 'webhook' || connection === 'wss') {
    const { path: hookPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: `  ${connection === 'webhook' ? 'Webhook POST' : '反向 WS'} 路径:`,
        default: connection === 'webhook' ? '/milky/webhook' : '/milky/ws',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    endpointConfig.path = hookPath.trim();
  }

  const { accessToken } = await inquirer.prompt([
    {
      type: 'password',
      name: 'accessToken',
      message: '  access_token（无则留空）:',
      default: '',
    },
  ]);
  if (accessToken?.trim()) {
    ctx.envVars.MILKY_ACCESS_TOKEN = accessToken.trim();
    endpointConfig.access_token = '${MILKY_ACCESS_TOKEN}';
  }

  return { connection, endpoints: [endpointConfig] };
}

export async function configureSatoriBot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('satori')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: '正向 WebSocket (ws) — 本 Bot 连 Satori SDK', value: 'ws' },
        { name: 'Webhook (webhook) — SDK POST 事件到 path（由内置 HTTP Host 承接）', value: 'webhook' },
      ],
      default: 'ws',
    },
  ]);

  const { endpointName, baseUrl } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'satori-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'input',
      name: 'baseUrl',
      message: '  Satori SDK baseUrl:',
      default: 'http://127.0.0.1:5140',
      validate: (v: string) => (v.trim() ? true : 'baseUrl 不能为空'),
    },
  ]);

  // schema：connection 为顶层共享字段；name / baseUrl / token / path 为 endpoint 级
  const endpointConfig: Record<string, unknown> = {
    name: endpointName.trim(),
    baseUrl: baseUrl.trim(),
  };

  if (connection === 'webhook') {
    const { path: hookPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '  Webhook POST 路径:',
        default: '/satori/webhook',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    endpointConfig.path = hookPath.trim();
  }

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: '  Bearer Token（无则留空）:',
      default: '',
    },
  ]);
  if (token?.trim()) {
    ctx.envVars.SATORI_TOKEN = token.trim();
    endpointConfig.token = '${SATORI_TOKEN}';
  }

  return { connection, endpoints: [endpointConfig] };
}

/**
 * 微信 iLink（个人微信 / ClawBot）配置：默认走扫码绑定 —— 终端展示二维码，
 * 微信扫码确认后 bot_token 写入 .env（`WEIXIN_ILINK_TOKEN`），
 * zhin.config.yml 只留 `${WEIXIN_ILINK_TOKEN}` 引用；扫码失败可降级手动输入 token。
 */
export async function configureWeixinIlinkBot(ctx: EndpointConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('weixin-ilink')));
  console.log(chalk.gray('     需最新版微信 + ClawBot 灰度资格（仅私聊）'));

  const { endpointName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpointName',
      message: '  Endpoint 标识名称:',
      default: 'weixin-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  const { method } = await inquirer.prompt([
    {
      type: 'select',
      name: 'method',
      message: '  登录方式:',
      choices: [
        { name: '扫码绑定（微信 ClawBot 入口扫码，自动获取 bot_token）', value: 'qr' },
        { name: '手动输入 bot_token', value: 'manual' },
      ],
      default: 'qr',
    },
  ]);

  if (method === 'qr') {
    const scanned = await tryQrLogin(ctx);
    if (scanned) {
      return {
        endpoints: [{ name: endpointName.trim(), botToken: '${WEIXIN_ILINK_TOKEN}' }],
      };
    }
    console.log(chalk.yellow('     扫码未完成，降级为手动输入 bot_token'));
  }

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: '  iLink Bot Token:',
      validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
    },
  ]);
  ctx.envVars.WEIXIN_ILINK_TOKEN = token.trim();
  return {
    endpoints: [{ name: endpointName.trim(), botToken: '${WEIXIN_ILINK_TOKEN}' }],
  };
}

/** 扫码尝试：成功写入 envVars 并返回 true；用户放弃/过期/超时返回 false。 */
async function tryQrLogin(ctx: EndpointConfigureContext): Promise<boolean> {
  // 动态加载 qrcode：扫码路径才需要，失败则降级为纯链接展示
  let renderQr: ((text: string) => Promise<string>) | undefined;
  try {
    const qrcode = await import('qrcode');
    renderQr = (text) => qrcode.toString(text, { type: 'terminal', small: true });
  } catch {
    renderQr = undefined;
  }

  for (;;) {
    try {
      const creds = await loginWithIlinkQr({
        onQrCode: async (url) => {
          console.log('');
          if (renderQr) {
            console.log(await renderQr(url));
          }
          console.log(chalk.cyan('     请用微信扫描上方二维码（或打开链接完成绑定）:'));
          console.log(chalk.cyan(`     ${url}`));
          console.log('');
        },
        onStatus: (status) => {
          if (status === 'scaned') {
            console.log(chalk.green('     已扫码，请在微信中确认…'));
          }
        },
      });
      ctx.envVars.WEIXIN_ILINK_TOKEN = creds.botToken;
      console.log(chalk.green('     绑定成功，bot_token 已写入 .env（WEIXIN_ILINK_TOKEN）'));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.yellow(`     扫码登录失败：${message}`));
      const { retry } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'retry',
          message: '  重新获取二维码再试一次？（选否则手动输入 token）',
          default: error instanceof IlinkQrLoginError && error.reason === 'expired',
        },
      ]);
      if (!retry) return false;
    }
  }
}
