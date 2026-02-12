import inquirer from 'inquirer';
import chalk from 'chalk';

export interface AdapterSetupResult {
  packages: string[];           // 需要安装的适配器 npm 包
  plugins: string[];            // plugins 列表中的适配器名
  bots: Array<Record<string, any>>;  // bots 配置数组
  envVars: Record<string, string>;   // 写入 .env 的环境变量
}

// 适配器定义
interface AdapterDefinition {
  name: string;
  value: string;
  package: string;
  plugin: string;
  extraDeps?: Record<string, string>;
  needsHttp: boolean;
  fields: AdapterField[];
}

interface AdapterField {
  key: string;
  message: string;
  type?: 'input' | 'password' | 'list';
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
    fields: [], // Sandbox 不需要额外配置
  },
  {
    name: 'ICQQ (QQ)',
    value: 'icqq',
    package: '@zhin.js/adapter-icqq',
    plugin: '@zhin.js/adapter-icqq',
    extraDeps: { '@icqqjs/icqq': 'latest' },
    needsHttp: false,
    fields: [
      { key: 'name', message: 'QQ 号:', required: true, envKey: 'ICQQ_ACCOUNT' },
      { key: 'password', message: 'QQ 密码（留空扫码登录）:', type: 'password', envKey: 'ICQQ_PASSWORD' },
      {
        key: 'platform', message: '登录平台:', type: 'list', default: '5',
        choices: [
          { name: 'iPad (推荐)', value: '5' },
          { name: 'Android 手机', value: '1' },
          { name: 'Android 手表', value: '3' },
          { name: 'macOS', value: '4' },
        ]
      },
      { key: 'sign_api_addr', message: '签名 API 地址:', required: true, envKey: 'ICQQ_SIGN_API_ADDR' },
    ],
  },
  {
    name: 'QQ 官方',
    value: 'qq',
    package: '@zhin.js/adapter-qq',
    plugin: '@zhin.js/adapter-qq',
    needsHttp: false,
    fields: [
      { key: 'appId', message: 'App ID:', required: true, envKey: 'QQ_APP_ID' },
      { key: 'appSecret', message: 'App Secret:', required: true, type: 'password', envKey: 'QQ_APP_SECRET' },
      { key: 'mode', message: '接受消息模式:', type: 'list', default: 'public',
        choices: [
          { name: 'websocket 模式（推荐）', value: 'websocket' },
          { name: 'webhook 模式', value: 'webhook' },
          { name: 'middleware 模式', value: 'middleware' },
        ]
      },
      {
        key: 'sandbox', message: '是否为沙箱环境:', type: 'list', default: 'false',
        choices: [
          { name: '正式环境', value: 'false' },
          { name: '沙箱环境', value: 'true' },
        ]
      }
    ],
  },
  {
    name: 'KOOK',
    value: 'kook',
    package: '@zhin.js/adapter-kook',
    plugin: '@zhin.js/adapter-kook',
    needsHttp: true,
    fields: [
      { key: 'token', message: 'KOOK Bot Token:', required: true, type: 'password', envKey: 'KOOK_TOKEN' },
    ],
  },
  {
    name: 'Discord',
    value: 'discord',
    package: '@zhin.js/adapter-discord',
    plugin: '@zhin.js/adapter-discord',
    extraDeps: { 'discord.js': 'latest' },
    needsHttp: true,
    fields: [
      { key: 'token', message: 'Discord Bot Token:', required: true, type: 'password', envKey: 'DISCORD_TOKEN' },
    ],
  },
  {
    name: 'Telegram',
    value: 'telegram',
    package: '@zhin.js/adapter-telegram',
    plugin: '@zhin.js/adapter-telegram',
    needsHttp: false,
    fields: [
      { key: 'token', message: 'Telegram Bot Token:', required: true, type: 'password', envKey: 'TELEGRAM_TOKEN' },
    ],
  },
  {
    name: 'Slack',
    value: 'slack',
    package: '@zhin.js/adapter-slack',
    plugin: '@zhin.js/adapter-slack',
    needsHttp: false,
    fields: [
      { key: 'botToken', message: 'Slack Bot Token:', required: true, type: 'password', envKey: 'SLACK_BOT_TOKEN' },
      { key: 'signingSecret', message: 'Signing Secret:', required: true, type: 'password', envKey: 'SLACK_SIGNING_SECRET' },
      { key: 'appToken', message: 'App Token:', required: true, type: 'password', envKey: 'SLACK_APP_TOKEN' },
    ],
  },
  {
    name: '钉钉',
    value: 'dingtalk',
    package: '@zhin.js/adapter-dingtalk',
    plugin: '@zhin.js/adapter-dingtalk',
    needsHttp: true,
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
    fields: [
      {
        key: 'type', message: '连接方式:', type: 'list', default: 'ws_reverse',
        choices: [
          { name: '反向 WebSocket（推荐）', value: 'ws_reverse' },
          { name: '正向 WebSocket', value: 'ws' },
          { name: 'HTTP SSE', value: 'http_sse' },
        ]
      },
      { key: 'url', message: '连接地址:', default: 'ws://127.0.0.1:6700' },
    ],
  },
  {
    name: '微信公众号',
    value: 'wechat-mp',
    package: '@zhin.js/adapter-wechat-mp',
    plugin: '@zhin.js/adapter-wechat-mp',
    needsHttp: true,
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
    fields: [
      { key: 'smtpHost', message: 'SMTP 服务器:', required: true, default: 'smtp.qq.com' },
      { key: 'smtpPort', message: 'SMTP 端口:', default: '465' },
      { key: 'imapHost', message: 'IMAP 服务器:', required: true, default: 'imap.qq.com' },
      { key: 'imapPort', message: 'IMAP 端口:', default: '993' },
      { key: 'user', message: '邮箱地址:', required: true, envKey: 'EMAIL_USER' },
      { key: 'password', message: '邮箱密码/授权码:', required: true, type: 'password', envKey: 'EMAIL_PASSWORD' },
    ],
  },
];

/**
 * 适配器选择与 Bot 配置引导向导
 */
export async function configureAdapters(): Promise<AdapterSetupResult> {
  console.log('');
  console.log(chalk.blue('🔌 配置聊天适配器'));

  // 列出适配器供用户多选，sandbox 默认勾选
  const { selectedAdapters } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedAdapters',
      message: '选择聊天平台适配器（空格选择，回车确认）:',
      choices: ADAPTERS.map(a => ({
        name: a.name,
        value: a.value,
        checked: a.value === 'sandbox',
        disabled: a.value === 'sandbox' ? '默认必选' : false,
      })),
      validate: (input: string[]) => {
        if (input.length === 0) return '至少选择一个适配器';
        return true;
      }
    }
  ]);

  // 确保 sandbox 始终在列表中
  const adapterValues: string[] = selectedAdapters.includes('sandbox')
    ? selectedAdapters
    : ['sandbox', ...selectedAdapters];

  const result: AdapterSetupResult = {
    packages: [],
    plugins: [],
    bots: [],
    envVars: {},
  };

  // 收集每个适配器的配置
  for (const adapterValue of adapterValues) {
    const adapterDef = ADAPTERS.find(a => a.value === adapterValue);
    if (!adapterDef) continue;

    // 添加包和插件名
    result.packages.push(adapterDef.package);
    if (adapterDef.extraDeps) {
      for (const [pkg, ver] of Object.entries(adapterDef.extraDeps)) {
        result.packages.push(`${pkg}@${ver}`);
      }
    }
    result.plugins.push(adapterDef.plugin);

    // Sandbox 不需要 bot 配置
    if (adapterValue === 'sandbox') continue;

    // 如果该适配器没有配置字段，跳过
    if (adapterDef.fields.length === 0) continue;

    console.log('');
    console.log(chalk.yellow(`  📝 配置 ${adapterDef.name.split(' (')[0]} Bot`));

    const botConfig: Record<string, any> = {
      context: adapterDef.value,
    };

    for (const field of adapterDef.fields) {
      const promptConfig: any = {
        type: field.type || 'input',
        name: 'value',
        message: `  ${field.message}`,
        default: field.default,
      };

      if (field.type === 'list' && field.choices) {
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
        botConfig[field.key] = `\${${field.envKey}}`;
      } else {
        botConfig[field.key] = value;
      }
    }

    result.bots.push(botConfig);
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
 * 生成 YAML 格式的 bots 配置段
 */
export function generateBotsConfigYaml(result: AdapterSetupResult): string {
  if (result.bots.length === 0) return '';

  const lines: string[] = ['', 'bots:'];
  for (const bot of result.bots) {
    const { context, ...config } = bot;
    lines.push(`  - context: ${context}`);
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'object') {
        lines.push(`    ${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`    ${key}: ${value}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * 生成 TS/JS 格式的 bots 配置段
 */
export function generateBotsConfigTS(result: AdapterSetupResult): string {
  if (result.bots.length === 0) return '';

  const lines: string[] = ['    bots: ['];

  for (const bot of result.bots) {
    lines.push('      {');
    for (const [key, value] of Object.entries(bot)) {
      if (typeof value === 'string' && value.startsWith('${')) {
        // 环境变量引用 — 保持 '${VAR}' 格式
        lines.push(`        ${key}: '${value}',`);
      } else if (typeof value === 'string') {
        lines.push(`        ${key}: '${value}',`);
      } else {
        lines.push(`        ${key}: ${JSON.stringify(value)},`);
      }
    }
    lines.push('      },');
  }

  lines.push('    ],');
  return lines.join('\n');
}

/**
 * 生成 JSON 格式的 bots 配置段
 */
export function generateBotsConfigJSON(result: AdapterSetupResult): string {
  if (result.bots.length === 0) return '';
  return `  "bots": ${JSON.stringify(result.bots, null, 4).replace(/^/gm, '  ').trimStart()},`;
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
