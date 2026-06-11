import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  ADAPTERS_DOCS_URL,
  adapterDocsUrl,
  configureDiscordEndpoint,
  configureGitHubEndpoint,
  configureOneBot11Bot,
  configureQQBot,
  configureSlackEndpoint,
  configureTelegramEndpoint,
} from './adapter-configurers.js';

export interface AdapterSetupResult {
  packages: string[];
  plugins: string[];
  endpoints: Array<Record<string, any>>;
  envVars: Record<string, string>;
  /** 所选适配器需要 database 插件（如 GitHub 订阅/OAuth 表） */
  requiresDatabase?: boolean;
}

// 适配器定义
interface AdapterDefinition {
  name: string;
  value: string;
  package: string;
  plugin: string;
  extraDeps?: Record<string, string>;
  needsHttp: boolean;
  description?: string;
  setupHint?: string;
  /** 文档：zhin.js.org/adapters/<slug>；索引见 ADAPTERS_DOCS_URL */
  docUrl?: string;
  requiresDatabase?: boolean;
  configure?: (ctx: import('./adapter-configurers.js').EndpointConfigureContext) => Promise<Record<string, unknown>>;
  fields: AdapterField[];
}

interface AdapterField {
  key: string;
  message: string;
  type?: 'input' | 'password' | 'select';
  default?: string;
  required?: boolean;
  envKey?: string;       // 如果是敏感信息，对应的环境变量名
  choices?: { name: string; value: string }[];
}

const ADAPTERS: AdapterDefinition[] = [
  {
    name: 'Sandbox (调试沙盒，默认)',
    value: 'sandbox',
    package: '@zhin.js/adapter-sandbox',
    plugin: '@zhin.js/adapter-sandbox',
    needsHttp: true,
    description: '终端 + Remote Console 沙盒页，本地开发首选',
    setupHint: '无需额外凭据；pnpm dev 后可在终端或 Console 沙盒页直接对话。',
    fields: [],
  },
  {
    name: 'ICQQ (QQ)',
    value: 'icqq',
    package: '@zhin.js/adapter-icqq',
    plugin: '@zhin.js/adapter-icqq',
    needsHttp: false,
    description: '非官方 QQ 协议，需本地登录',
    setupHint: '先安装 icqq CLI 并登录：pnpm dlx icqq login <QQ号>，登录态保存在 ~/.icqq/。',
    docUrl: adapterDocsUrl('icqq'),
    fields: [
      { key: 'name', message: 'QQ 号（与 icqq login 时一致）:', required: true, envKey: 'ICQQ_ACCOUNT' },
    ],
  },
  {
    name: 'QQ 官方',
    value: 'qq',
    package: '@zhin.js/adapter-qq',
    plugin: '@zhin.js/adapter-qq',
    needsHttp: false,
    description: 'QQ 开放平台官方 Bot',
    setupHint: '在 q.qq.com/bot 创建机器人，获取 AppID / Token / Secret；mode 选 public 或 private。',
    docUrl: adapterDocsUrl('qq'),
    configure: configureQQBot,
    fields: [],
  },
  {
    name: 'KOOK',
    value: 'kook',
    package: '@zhin.js/adapter-kook',
    plugin: '@zhin.js/adapter-kook',
    needsHttp: true,
    description: 'KOOK 语音平台 Endpoint',
    setupHint: '在 KOOK 开发者中心创建 Endpoint 并复制 Token；需配置 Webhook 回调地址（公网或内网穿透）。',
    fields: [
      { key: 'token', message: 'KOOK Endpoint Token:', required: true, type: 'password', envKey: 'KOOK_TOKEN' },
    ],
  },
  {
    name: 'Discord',
    value: 'discord',
    package: '@zhin.js/adapter-discord',
    plugin: '@zhin.js/adapter-discord',
    needsHttp: true,
    description: 'Discord（Gateway 或 Interactions）',
    setupHint: 'Developer Portal 创建 Bot；Gateway 用 Token，Interactions 需 Application ID + Public Key。',
    docUrl: adapterDocsUrl('discord'),
    configure: configureDiscordEndpoint,
    fields: [],
  },
  {
    name: 'Telegram',
    value: 'telegram',
    package: '@zhin.js/adapter-telegram',
    plugin: '@zhin.js/adapter-telegram',
    needsHttp: false,
    description: 'Telegram Bot（polling / webhook 可选）',
    setupHint: '@BotFather 获取 Token；polling 适合本地，webhook 需 HTTPS 公网域名。',
    docUrl: adapterDocsUrl('telegram'),
    configure: configureTelegramEndpoint,
    fields: [],
  },
  {
    name: 'Slack',
    value: 'slack',
    package: '@zhin.js/adapter-slack',
    plugin: '@zhin.js/adapter-slack',
    needsHttp: false,
    description: 'Slack（Socket Mode 或 HTTP Events）',
    setupHint: 'Socket Mode 无需公网；HTTP 模式需配置 Event Subscriptions URL。',
    docUrl: adapterDocsUrl('slack'),
    configure: configureSlackEndpoint,
    fields: [],
  },
  {
    name: '钉钉',
    value: 'dingtalk',
    package: '@zhin.js/adapter-dingtalk',
    plugin: '@zhin.js/adapter-dingtalk',
    needsHttp: true,
    description: '钉钉企业内部应用 / 机器人',
    setupHint: '在钉钉开放平台创建应用，配置机器人并设置 HTTP 回调 URL（需公网可达）。',
    fields: [
      { key: 'appKey', message: 'App Key:', required: true, envKey: 'DINGTALK_APP_KEY' },
      { key: 'appSecret', message: 'App Secret:', required: true, type: 'password', envKey: 'DINGTALK_APP_SECRET' },
      { key: 'webhookPath', message: 'Webhook 路径:', default: '/dingtalk/webhook' },
    ],
  },
  {
    name: '飞书',
    value: 'lark',
    package: '@zhin.js/adapter-lark',
    plugin: '@zhin.js/adapter-lark',
    needsHttp: true,
    description: '飞书 / Lark 企业应用',
    setupHint: '在飞书开放平台创建企业自建应用，启用机器人并配置事件订阅 URL（需公网可达）。',
    fields: [
      { key: 'appId', message: 'App ID:', required: true, envKey: 'LARK_APP_ID' },
      { key: 'appSecret', message: 'App Secret:', required: true, type: 'password', envKey: 'LARK_APP_SECRET' },
      { key: 'webhookPath', message: 'Webhook 路径:', default: '/lark/webhook' },
    ],
  },
  {
    name: 'OneBot v11',
    value: 'onebot11',
    package: '@zhin.js/adapter-onebot11',
    plugin: '@zhin.js/adapter-onebot11',
    needsHttp: false,
    description: 'OneBot v11（ws 正向 / wss 反向）',
    setupHint: 'connection: ws 连 OneBot 实现；connection: wss 反向连接（需 host-router）。',
    docUrl: adapterDocsUrl('onebot11'),
    configure: configureOneBot11Bot,
    fields: [],
  },
  {
    name: '微信公众号',
    value: 'wechat-mp',
    package: '@zhin.js/adapter-wechat-mp',
    plugin: '@zhin.js/adapter-wechat-mp',
    needsHttp: true,
    description: '微信公众平台（服务号/订阅号）',
    setupHint: '在微信公众平台配置服务器 URL 与 Token；需备案域名且公网 HTTPS 可达。',
    fields: [
      { key: 'appId', message: 'App ID:', required: true, envKey: 'WECHAT_APP_ID' },
      { key: 'appSecret', message: 'App Secret:', required: true, type: 'password', envKey: 'WECHAT_APP_SECRET' },
      { key: 'token', message: '验证 Token:', required: true, envKey: 'WECHAT_TOKEN' },
      { key: 'webhookPath', message: 'Webhook 路径:', default: '/wechat/webhook' },
    ],
  },
  {
    name: 'Email',
    value: 'email',
    package: '@zhin.js/adapter-email',
    plugin: '@zhin.js/adapter-email',
    needsHttp: false,
    description: 'SMTP 发信 + IMAP 收信',
    setupHint: '使用邮箱 SMTP/IMAP 凭据；QQ/163 等需开启授权码而非登录密码。',
    fields: [
      { key: 'smtpHost', message: 'SMTP 服务器:', required: true, default: 'smtp.qq.com' },
      { key: 'smtpPort', message: 'SMTP 端口:', default: '465' },
      { key: 'imapHost', message: 'IMAP 服务器:', required: true, default: 'imap.qq.com' },
      { key: 'imapPort', message: 'IMAP 端口:', default: '993' },
      { key: 'user', message: '邮箱地址:', required: true, envKey: 'EMAIL_USER' },
      { key: 'password', message: '邮箱密码/授权码:', required: true, type: 'password', envKey: 'EMAIL_PASSWORD' },
    ],
  },
  {
    name: 'GitHub',
    value: 'github',
    package: '@zhin.js/adapter-github',
    plugin: '@zhin.js/adapter-github',
    needsHttp: true,
    description: 'GitHub Issue/PR 聊天 + App 认证',
    setupHint: 'GitHub App 或 gh CLI；Webhook 用 /pub/github/webhook；需 database 存订阅与 OAuth。',
    docUrl: adapterDocsUrl('github'),
    requiresDatabase: true,
    configure: configureGitHubEndpoint,
    fields: [],
  },
];

/**
 * 适配器选择与 Endpoint 配置引导向导
 */
export async function configureAdapters(): Promise<AdapterSetupResult> {
  console.log('');
  console.log(chalk.blue('🔌 配置聊天适配器'));
  console.log(chalk.gray('  Sandbox 适合本地调试；生产环境请额外勾选目标 IM 平台。'));
  console.log(chalk.gray('  带 Webhook 的适配器需要 Endpoint 可被公网访问（或使用内网穿透）。'));

  const { selectedAdapters } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedAdapters',
      message: '选择聊天平台适配器（空格选择，回车确认）:',
      choices: ADAPTERS.map(a => ({
        name: a.description ? `${a.name} — ${a.description}` : a.name,
        value: a.value,
        checked: a.value === 'sandbox',
        disabled: a.value === 'sandbox' ? '默认必选' : false,
      })),
      validate: (input: string[]) => {
        if (input.length === 0) return '至少选择一个适配器';
        return true;
      },
      pageSize: 14,
    }
  ]);

  const adapterValues: string[] = selectedAdapters.includes('sandbox')
    ? selectedAdapters
    : ['sandbox', ...selectedAdapters];

  const httpAdapters = adapterValues
    .map(v => ADAPTERS.find(a => a.value === v))
    .filter((a): a is AdapterDefinition => !!a && a.needsHttp && a.value !== 'sandbox');

  if (httpAdapters.length > 0) {
    console.log('');
    console.log(chalk.yellow('  ⚠ 以下适配器通常需要公网 HTTP/Webhook：'));
    for (const adapter of httpAdapters) {
      console.log(chalk.gray(`    • ${adapter.name.split(' (')[0]}`));
    }
    console.log(chalk.gray('    开发时可先用 Sandbox；上线前请确保 http 端口（默认 8086）可从平台回调。'));
  }

  const result: AdapterSetupResult = {
    packages: [],
    plugins: [],
    endpoints: [],
    envVars: {},
    requiresDatabase: false,
  };

  for (const adapterValue of adapterValues) {
    const adapterDef = ADAPTERS.find(a => a.value === adapterValue);
    if (!adapterDef) continue;

    result.packages.push(adapterDef.package);
    if (adapterDef.extraDeps) {
      for (const [pkg, ver] of Object.entries(adapterDef.extraDeps)) {
        result.packages.push(`${pkg}@${ver}`);
      }
    }
    result.plugins.push(adapterDef.plugin);
    if (adapterDef.requiresDatabase) {
      result.requiresDatabase = true;
    }

    if (adapterValue === 'sandbox') continue;

    const hasConfig = adapterDef.configure || adapterDef.fields.length > 0;
    if (!hasConfig) continue;

    console.log('');
    console.log(chalk.yellow(`  📝 配置 ${adapterDef.name.split(' (')[0]} Bot`));
    if (adapterDef.setupHint) {
      console.log(chalk.gray(`     ${adapterDef.setupHint}`));
    }
    if (adapterDef.docUrl && !adapterDef.configure) {
      console.log(chalk.gray(`     文档: ${adapterDef.docUrl}`));
    }
    console.log(chalk.gray(`     索引: ${ADAPTERS_DOCS_URL}`));

    if (adapterDef.configure) {
      let markedDb = false;
      const endpointConfig = await adapterDef.configure({
        envVars: result.envVars,
        markRequiresDatabase: () => {
          markedDb = true;
          result.requiresDatabase = true;
        },
      });
      if (markedDb) result.requiresDatabase = true;
      result.endpoints.push(endpointConfig);
      continue;
    }

    const endpointConfig: Record<string, any> = {
      context: adapterDef.value,
    };

    for (const field of adapterDef.fields) {
      const promptConfig: any = {
        type: field.type || 'input',
        name: 'value',
        message: `  ${field.message}`,
        default: field.default,
      };

      if (field.type === 'select' && field.choices) {
        promptConfig.choices = field.choices;
      }

      if (field.required) {
        promptConfig.validate = (input: string) => {
          if (!input || !input.trim()) return `${field.message.replace(':', '')} 不能为空`;
          return true;
        };
      }

      const { value } = await inquirer.prompt([promptConfig]);

      if (field.envKey) {
        // 敏感信息存 .env，配置引用环境变量
        result.envVars[field.envKey] = value || '';
        endpointConfig[field.key] = `\${${field.envKey}}`;
      } else {
        endpointConfig[field.key] = value;
      }
    }

    result.endpoints.push(endpointConfig);
  }

  return result;
}

/**
 * 获取适配器配置需要写入 .env 的环境变量文本
 */
export function generateAdapterEnvVars(result: AdapterSetupResult): string {
  const entries = Object.entries(result.envVars);
  if (entries.length === 0) return '';

  const lines: string[] = ['', '# 适配器配置'];
  for (const [key, value] of entries) {
    lines.push(`${key}=${value}`);
  }
  return lines.join('\n');
}

/**
 * 将 Endpoint 配置项格式化为 YAML 行
 */
function appendYamlValue(lines: string[], key: string, value: unknown, indent: number): void {
  const pad = '  '.repeat(indent);
  if (value === undefined || value === null) return;

  if (typeof value === 'object' && !Array.isArray(value)) {
    lines.push(`${pad}${key}:`);
    for (const [subKey, subValue] of Object.entries(value)) {
      appendYamlValue(lines, subKey, subValue, indent + 1);
    }
    return;
  }

  if (Array.isArray(value)) {
    lines.push(`${pad}${key}:`);
    for (const item of value) {
      if (typeof item === 'string') {
        lines.push(`${pad}  - "${item}"`);
      } else {
        lines.push(`${pad}  - ${item}`);
      }
    }
    return;
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    lines.push(`${pad}${key}: ${value}`);
    return;
  }

  lines.push(`${pad}${key}: ${value}`);
}

/**
 * 生成 YAML 格式的 endpoints 配置段
 */
export function generateEndpointsConfigYaml(result: AdapterSetupResult): string {
  if (result.endpoints.length === 0) {
    return `

# Sandbox：Remote Console 打开「沙盒」页并通过 WebSocket 连接时自动创建 Endpoint
endpoints: []
`;
  }

  const lines: string[] = ['', 'endpoints:'];
  for (const entry of result.endpoints) {
    const { context, ...config } = entry;
    lines.push(`  - context: ${context}`);
    for (const [key, value] of Object.entries(config)) {
      appendYamlValue(lines, key, value, 2);
    }
  }

  return lines.join('\n');
}

/**
 * 生成 TOML 格式的 endpoints 配置段
 */
export function generateEndpointsConfigToml(result: AdapterSetupResult): string {
  if (result.endpoints.length === 0) return '';

  const lines: string[] = [''];
  for (const entry of result.endpoints) {
    lines.push('[[endpoints]]');
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value === 'string') {
        lines.push(`${key} = "${value.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key} = ${JSON.stringify(value)}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 生成 JSON 格式的 endpoints 配置段
 */
export function generateEndpointsConfigJSON(result: AdapterSetupResult): string {
  if (result.endpoints.length === 0) return '';
  return `  "endpoints": ${JSON.stringify(result.endpoints, null, 4).replace(/^/gm, '  ').trimStart()},`;
}

/**
 * 获取适配器配置后的简要说明（用于初始化完成提示）
 */
export function getAdapterSetupNotes(result: AdapterSetupResult): string[] {
  const notes: string[] = [];
  for (const entry of result.endpoints) {
    const context = entry.context as string;
    if (context === 'telegram' && entry.polling === false) {
      notes.push('Telegram Webhook: 确保 HTTPS 域名可从公网访问，且 webhook.port 已放行');
    }
    if (context === 'telegram' && entry.polling !== false) {
      notes.push('Telegram polling: 本地开发可直接 pnpm dev，无需公网');
    }
    if (context === 'github') {
      if (entry.webhook_secret) {
        notes.push('GitHub Webhook: App 设置 URL 为 https://<域名>/pub/github/webhook');
      } else {
        notes.push('GitHub polling: 无 Webhook 时将轮询 Events API（默认 60s）');
      }
      if (entry.app_id) {
        notes.push('GitHub App: 私钥路径需存在，且 App 已安装到目标仓库');
      } else {
        notes.push('GitHub gh CLI: 运行 gh auth login 完成认证');
      }
    }
  }

  for (const plugin of result.plugins) {
    const value = plugin.replace('@zhin.js/adapter-', '');
    const def = ADAPTERS.find(a => a.value === value);
    if (def?.setupHint && value !== 'sandbox' && !notes.some(n => n.startsWith(def.name.split(' (')[0]))) {
      notes.push(`${def.name.split(' (')[0]}: ${def.setupHint}`);
    }
  }

  if (result.requiresDatabase) {
    notes.push('已选适配器需要 database：脚手架将自动配置 SQLite');
  }

  return notes;
}

/**
 * 获取适配器所需的额外依赖包
 */
export function getAdapterDependencies(result: AdapterSetupResult): Record<string, string> {
  const deps: Record<string, string> = {};

  for (const pkg of result.packages) {
    if (pkg.includes('@')) {
      // 处理 package@version 格式
      const atIdx = pkg.lastIndexOf('@');
      if (atIdx > 0) {
        const name = pkg.substring(0, atIdx);
        const version = pkg.substring(atIdx + 1);
        if (name.startsWith('@')) {
          // 如 @icqqjs/icqq@latest
          deps[name] = version;
        } else {
          deps[name] = version;
        }
      } else {
        deps[pkg] = 'latest';
      }
    } else {
      deps[pkg] = 'latest';
    }
  }

  return deps;
}
