import inquirer from 'inquirer';
import chalk from 'chalk';

/** 平台适配器文档索引 */
export const ADAPTERS_DOCS_URL = 'https://zhin.js.org/adapters/';

/** @deprecated 使用 ADAPTERS_DOCS_URL */
export const ADAPTERS_INDEX_URL = ADAPTERS_DOCS_URL;

/** 框架级适配器概念（多平台、群管工具等） */
export const ADAPTERS_ESSENTIALS_URL = 'https://zhin.js.org/essentials/adapters';

/** 各适配器文档页（与 docs/adapters/*.md 同步） */
export const adapterDocsUrl = (slug: string) => `https://zhin.js.org/adapters/${slug}`;

export interface BotConfigureContext {
  envVars: Record<string, string>;
  markRequiresDatabase: () => void;
}

export async function configureTelegramBot(ctx: BotConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('telegram')));

  const { botName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'botName',
      message: '  Bot 标识名称:',
      default: 'telegram-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  const { token } = await inquirer.prompt([
    {
      type: 'password',
      name: 'token',
      message: '  Telegram Bot Token（@BotFather 获取）:',
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

  const botConfig: Record<string, unknown> = {
    context: 'telegram',
    name: botName.trim(),
    token: '${TELEGRAM_TOKEN}',
    polling: transport === 'polling',
  };

  if (transport === 'webhook') {
    console.log('');
    console.log(chalk.yellow('     Webhook 前置条件：'));
    console.log(chalk.gray('     • Bot 进程需绑定可被 Telegram 访问的 HTTPS 域名（有效 TLS 证书）'));
    console.log(chalk.gray('     • 在 @BotFather 可配合 setWebhook，或由 Telegraf 在 launch 时注册'));
    console.log(chalk.gray('     • 防火墙/反向代理需放行 webhook.port（默认由 Telegraf 监听）'));

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
        default: '/telegram-webhook',
      },
      {
        type: 'input',
        name: 'port',
        message: '  本地监听端口（Telegraf webhook server）:',
        default: '8443',
        validate: (v: string) => {
          const p = parseInt(v, 10);
          if (Number.isNaN(p) || p < 1 || p > 65535) return '请输入 1–65535 端口';
          return true;
        },
      },
    ]);

    botConfig.polling = false;
    botConfig.webhook = {
      domain: webhook.domain.trim(),
      path: webhook.path.trim(),
      port: parseInt(webhook.port, 10),
    };
  }

  return botConfig;
}

export async function configureGitHubBot(ctx: BotConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('github')));
  ctx.markRequiresDatabase();

  const { botName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'botName',
      message: '  Bot 标识名称:',
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

  const botConfig: Record<string, unknown> = {
    context: 'github',
    name: botName.trim(),
  };

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
    botConfig.app_id = '${GITHUB_APP_ID}';
    botConfig.private_key = appConfig.private_key.trim();
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
          name: 'Webhook 实时推送（需 @zhin.js/host-router + 公网 URL）',
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
    console.log(chalk.gray('     • plugins 需包含 @zhin.js/host-router（脚手架已默认写入）'));
    console.log(chalk.gray('     • GitHub App Webhook URL 填 https://<你的域名>/pub/github/webhook'));
    console.log(chalk.gray('     • /pub/* 路径绕过 Bearer 认证，供 GitHub 回调'));

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
        default: '/pub/github/webhook',
      },
    ]);

    ctx.envVars.GITHUB_WEBHOOK_SECRET = webhook.webhook_secret;
    botConfig.webhook_secret = '${GITHUB_WEBHOOK_SECRET}';
    botConfig.webhook_path = webhook.webhook_path.trim();
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
    botConfig.poll_interval = parseInt(poll_interval, 10);
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

  return botConfig;
}

export async function configureOneBot11Bot(ctx: BotConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('onebot11')));

  const { connection } = await inquirer.prompt([
    {
      type: 'select',
      name: 'connection',
      message: '  连接方式:',
      choices: [
        { name: '正向 WebSocket (ws) — 本 Bot 连接 OneBot 实现', value: 'ws' },
        { name: '反向 WebSocket (wss) — OneBot 实现连本 Bot（需 host-router）', value: 'wss' },
      ],
      default: 'ws',
    },
  ]);

  const { botName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'botName',
      message: '  Bot 标识名称:',
      default: 'onebot-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
  ]);

  const botConfig: Record<string, unknown> = {
    context: 'onebot11',
    connection,
    name: botName.trim(),
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
    botConfig.url = url.trim();
  } else {
    console.log(chalk.gray('     反向 WS 需启用 @zhin.js/host-router，OneBot 实现配置连接到此 Bot'));
    const { path: wsPath } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: '  反向 WS 路径:',
        default: '/onebot11/ws',
        validate: (v: string) => (v.trim() ? true : '路径不能为空'),
      },
    ]);
    botConfig.path = wsPath.trim();
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
    botConfig.access_token = '${ONEBOT11_ACCESS_TOKEN}';
  }

  return botConfig;
}

export async function configureQQBot(ctx: BotConfigureContext): Promise<Record<string, unknown>> {
  console.log(chalk.gray('     文档: ' + adapterDocsUrl('qq')));

  const credentials = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: '  Bot 标识名称:',
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
      name: 'token',
      message: '  Token:',
      validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
    },
    {
      type: 'password',
      name: 'secret',
      message: '  Secret:',
      validate: (v: string) => (v.trim() ? true : 'Secret 不能为空'),
    },
  ]);

  ctx.envVars.QQ_APP_ID = credentials.appID.trim();
  ctx.envVars.QQ_TOKEN = credentials.token;
  ctx.envVars.QQ_SECRET = credentials.secret;

  const { mode, sandbox } = await inquirer.prompt([
    {
      type: 'select',
      name: 'mode',
      message: '  消息接收模式 (mode):',
      choices: [
        { name: 'public — 公域消息', value: 'public' },
        { name: 'private — 私域消息', value: 'private' },
      ],
      default: 'public',
    },
    {
      type: 'confirm',
      name: 'sandbox',
      message: '  沙箱环境 (sandbox)?',
      default: false,
    },
  ]);

  return {
    context: 'qq',
    name: credentials.name.trim(),
    appID: '${QQ_APP_ID}',
    token: '${QQ_TOKEN}',
    secret: '${QQ_SECRET}',
    mode,
    platform: 'qq',
    sandbox,
  };
}

export async function configureDiscordBot(ctx: BotConfigureContext): Promise<Record<string, unknown>> {
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

  const { botName, token } = await inquirer.prompt([
    {
      type: 'input',
      name: 'botName',
      message: '  Bot 标识名称:',
      default: 'discord-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'password',
      name: 'token',
      message: '  Bot Token:',
      validate: (v: string) => (v.trim() ? true : 'Token 不能为空'),
    },
  ]);
  ctx.envVars.DISCORD_TOKEN = token;

  const botConfig: Record<string, unknown> = {
    context: 'discord',
    connection,
    name: botName.trim(),
    token: '${DISCORD_TOKEN}',
  };

  if (connection === 'interactions') {
    console.log(chalk.gray('     Interactions 模式需 @zhin.js/host-router 与 Developer Portal 中的公钥'));
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
    botConfig.applicationId = interactions.applicationId.trim();
    botConfig.publicKey = interactions.publicKey.trim();
    botConfig.interactionsPath = interactions.interactionsPath.trim();
  }

  return botConfig;
}

export async function configureSlackBot(ctx: BotConfigureContext): Promise<Record<string, unknown>> {
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

  const { botName, token, signingSecret } = await inquirer.prompt([
    {
      type: 'input',
      name: 'botName',
      message: '  Bot 标识名称:',
      default: 'slack-bot',
      validate: (v: string) => (v.trim() ? true : '名称不能为空'),
    },
    {
      type: 'password',
      name: 'token',
      message: '  Bot Token (xoxb-...):',
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

  const botConfig: Record<string, unknown> = {
    context: 'slack',
    name: botName.trim(),
    token: '${SLACK_BOT_TOKEN}',
    signingSecret: '${SLACK_SIGNING_SECRET}',
    socketMode: socketMode === 'true',
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
    botConfig.appToken = '${SLACK_APP_TOKEN}';
  } else {
    console.log(chalk.yellow('     HTTP 模式需公网可达并配置 Slack Event Subscriptions URL'));
    const { port } = await inquirer.prompt([
      {
        type: 'input',
        name: 'port',
        message: '  监听端口:',
        default: '3000',
      },
    ]);
    botConfig.port = parseInt(port, 10);
  }

  return botConfig;
}
