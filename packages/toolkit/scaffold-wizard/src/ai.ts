import inquirer from 'inquirer';
import chalk from 'chalk';

export interface AISetupConfig {
  enabled: boolean;
  defaultProvider?: string;
  providers?: Record<string, { apiKey?: string; host?: string; models?: string[]; baseUrl?: string }>;
  sessions?: { useDatabase: boolean; maxHistory: number; expireMs: number };
  context?: { enabled: boolean; maxRecentMessages: number; summaryThreshold: number; keepAfterSummary: number };
  agent?: {
    execSecurity: 'deny' | 'allowlist' | 'full';
    execPreset: 'readonly' | 'network' | 'development' | 'custom';
    execAllowlist: string[];
    phaseTrace: boolean;
  };
  trigger?: {
    respondToAt: boolean;
    respondToPrivate: boolean;
    prefixes: string[];
    ignorePrefixes: string[];
    timeout: number;
  };
  memoryMcp?: boolean;
  mcpServers?: Array<{
    name: string;
    transport: 'stdio' | 'streamable-http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
  }>;
}

// 提供商信息
const PROVIDERS = [
  {
    name: 'OpenAI (GPT-4o, 推荐)',
    value: 'openai',
    defaultModel: 'gpt-4o',
    hint: '需 OpenAI API Key；国内可用代理 baseUrl',
    keyPlaceholder: 'sk-...',
  },
  {
    name: 'Anthropic (Claude)',
    value: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    hint: '需 Anthropic API Key',
    keyPlaceholder: 'sk-ant-...',
  },
  {
    name: 'DeepSeek',
    value: 'deepseek',
    defaultModel: 'deepseek-chat',
    hint: '性价比高，国内直连',
    keyPlaceholder: 'sk-...',
  },
  {
    name: 'Moonshot (月之暗面)',
    value: 'moonshot',
    defaultModel: 'moonshot-v1-8k',
    hint: 'Kimi 同款 API',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '智谱 AI (GLM)',
    value: 'zhipu',
    defaultModel: 'glm-4-flash',
    hint: '国内直连，open.bigmodel.cn',
    keyPlaceholder: '...',
  },
  {
    name: 'Ollama (本地部署)',
    value: 'ollama',
    defaultModel: 'qwen3:8b',
    hint: '本地运行，无需 API Key；先 ollama pull 模型',
    keyPlaceholder: '',
  },
] as const;

function providerSdkFor(name: string): string {
  switch (name) {
    case 'anthropic':
      return 'anthropic';
    case 'google':
    case 'gemini':
      return 'google';
    case 'ollama':
      return 'ollama';
    case 'deepseek':
      return 'deepseek';
    case 'moonshot':
    case 'zhipu':
      return 'openai-compatible';
    default:
      return 'openai';
  }
}

function defaultModelForProvider(driver: string): string {
  const entry = PROVIDERS.find(p => p.value === driver);
  return entry?.defaultModel ?? '';
}

export const RECOMMENDED_AI_DEFAULTS = {
  sessions: {
    useDatabase: true,
    maxHistory: 100,
    expireMs: 7 * 24 * 60 * 60 * 1000,
  },
  context: {
    enabled: true,
    maxRecentMessages: 100,
    summaryThreshold: 50,
    keepAfterSummary: 10,
  },
  agent: {
    execSecurity: 'deny' as const,
    execPreset: 'custom' as const,
    execAllowlist: [] as string[],
    phaseTrace: false,
  },
  trigger: {
    ignorePrefixes: ['/', '!', '！'],
    timeout: 60_000,
  },
};

/**
 * AI 配置引导向导
 */
export async function configureAI(): Promise<AISetupConfig> {
  console.log('');
  console.log(chalk.blue('🤖 配置 AI 智能体'));
  console.log(chalk.gray('  启用后将预装 @modelcontextprotocol/sdk，支持 MCP 与 memory 扩展。'));
  console.log(chalk.gray('  会话持久化默认开启，将自动配置 SQLite 数据库（若尚未选择）。'));

  const { enableAI } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAI',
      message: '是否启用 AI 智能体？（大模型对话 + 工具调用）',
      default: true,
    }
  ]);

  if (!enableAI) {
    return { enabled: false };
  }

  const { provider } = await inquirer.prompt([
    {
      type: 'select',
      name: 'provider',
      message: '选择 AI 提供商:',
      choices: PROVIDERS.map(p => ({
        name: `${p.name} — ${p.hint}`,
        value: p.value,
      })),
      pageSize: 10,
    }
  ]);

  const providerInfo = PROVIDERS.find(p => p.value === provider)!;
  console.log(chalk.gray(`  ${providerInfo.hint}`));

  let providerConfig: Record<string, any> = {};
  const envVarName = `AI_API_KEY`;

  if (provider === 'ollama') {
    const ollamaConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Ollama 地址:',
        default: 'http://127.0.0.1:11434',
        validate: (input: string) => {
          if (!input.trim()) return '地址不能为空';
          if (!/^https?:\/\//.test(input.trim())) return '请输入 http:// 或 https:// 开头的地址';
          return true;
        },
      },
      {
        type: 'input',
        name: 'model',
        message: '模型名称（需已 ollama pull）:',
        default: providerInfo.defaultModel,
        validate: (input: string) => (input.trim() ? true : '模型名不能为空'),
      }
    ]);
    providerConfig = {
      host: ollamaConfig.host.trim(),
      models: [ollamaConfig.model.trim()],
    };
  } else {
    const cloudConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: `${providerInfo.name.split(' (')[0]} API Key:`,
        validate: (input: string) => {
          if (!input.trim()) return 'API Key 不能为空（可稍后在 .env 中填写 AI_API_KEY）';
          return true;
        }
      },
      {
        type: 'input',
        name: 'model',
        message: '模型名称:',
        default: providerInfo.defaultModel,
      },
      {
        type: 'input',
        name: 'baseUrl',
        message: '自定义 API 地址（留空使用官方默认）:',
        default: '',
      }
    ]);

    providerConfig = {
      apiKey: `\${${envVarName}}`,
      models: [cloudConfig.model?.trim() || providerInfo.defaultModel],
      ...(cloudConfig.baseUrl?.trim() ? { baseUrl: cloudConfig.baseUrl.trim() } : {}),
    };

    (providerConfig as any).__envApiKey = cloudConfig.apiKey.trim();
  }

  console.log('');
  console.log(chalk.blue('⚡ 配置 AI 触发方式'));
  console.log(chalk.gray('  决定 Endpoint 何时自动调用大模型；命令（/ 开头）不会被 AI 拦截。'));

  const triggerConfig = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'respondToAt',
      message: '响应 @机器人 的消息？',
      default: true,
    },
    {
      type: 'confirm',
      name: 'respondToPrivate',
      message: '响应私聊消息？',
      default: true,
    },
    {
      type: 'input',
      name: 'prefixes',
      message: '触发前缀（逗号分隔，如 #,ai:）:',
      default: '#',
    }
  ]);

  const prefixes = triggerConfig.prefixes
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);

  console.log('');
  console.log(chalk.blue('🛡️  配置 Agent 安全与能力'));
  console.log(chalk.gray('  生产环境建议 execSecurity: deny；开发调试可选 allowlist。'));

  const agentConfig = await inquirer.prompt([
    {
      type: 'select',
      name: 'execSecurity',
      message: '命令执行安全策略:',
      choices: [
        { name: 'deny — 禁止执行 shell（推荐）', value: 'deny' },
        { name: 'allowlist — 仅允许白名单命令', value: 'allowlist' },
        { name: 'full — 允许任意命令（仅本地调试）', value: 'full' },
      ],
      default: 'deny',
    },
    {
      type: 'confirm',
      name: 'memoryMcp',
      message: '启用本地知识图谱 memory MCP？（data/knowledge-graph.jsonl）',
      default: false,
    },
    {
      type: 'confirm',
      name: 'phaseTrace',
      message: '输出 Agent 阶段日志（便于排障）？',
      default: false,
    },
  ]);

  const execPreset = agentConfig.execSecurity === 'deny'
    ? 'readonly'
    : agentConfig.execSecurity === 'allowlist'
      ? 'development'
      : 'custom';

  return {
    enabled: true,
    defaultProvider: provider,
    providers: {
      [provider]: providerConfig,
    },
    sessions: RECOMMENDED_AI_DEFAULTS.sessions,
    context: RECOMMENDED_AI_DEFAULTS.context,
    agent: {
      execSecurity: agentConfig.execSecurity,
      execPreset,
      execAllowlist: [],
      phaseTrace: agentConfig.phaseTrace,
    },
    trigger: {
      respondToAt: triggerConfig.respondToAt,
      respondToPrivate: triggerConfig.respondToPrivate,
      prefixes: prefixes.length > 0 ? prefixes : ['#'],
      ignorePrefixes: RECOMMENDED_AI_DEFAULTS.trigger.ignorePrefixes,
      timeout: RECOMMENDED_AI_DEFAULTS.trigger.timeout,
    },
    memoryMcp: agentConfig.memoryMcp,
    mcpServers: [],
  };
}

/**
 * 获取 AI 配置需要写入 .env 的环境变量
 */
export function generateAIEnvVars(config: AISetupConfig): string {
  if (!config.enabled || !config.providers) return '';

  const envVars: string[] = ['', '# AI 配置'];

  for (const [, providerConfig] of Object.entries(config.providers)) {
    const realKey = (providerConfig as any).__envApiKey;
    if (realKey) {
      envVars.push(`AI_API_KEY=${realKey}`);
    }
  }

  return envVars.length > 1 ? envVars.join('\n') : '';
}

/**
 * 生成 YAML 格式的 AI 配置段
 */
export function generateAIConfigYaml(config: AISetupConfig): string {
  if (!config.enabled) return '';

  const providerAlias = config.defaultProvider || Object.keys(config.providers ?? {})[0] || 'openai';

  const lines: string[] = [
    '',
    'ai:',
    '  providers:',
  ];

  if (config.providers) {
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      lines.push(`    ${name}:`);
      lines.push(`      sdk: ${providerSdkFor(name)}`);
      if (providerConfig.apiKey) {
        lines.push(`      apiKey: ${providerConfig.apiKey}`);
      }
      if (providerConfig.host) {
        lines.push(`      host: ${providerConfig.host}`);
      }
      if (providerConfig.models) {
        lines.push('      models:');
        for (const model of providerConfig.models) {
          lines.push(`        - ${model}`);
        }
      }
      if (providerConfig.baseUrl) {
        lines.push(`      baseUrl: ${providerConfig.baseUrl}`);
      }
    }
  }

  const zhinModel = defaultModelForProvider(providerAlias)
    || config.providers?.[providerAlias]?.models?.[0]
    || '';
  lines.push('  agents:');
  lines.push('    zhin:');
  lines.push(`      provider: ${providerAlias}`);
  if (zhinModel) {
    lines.push(`      model: ${zhinModel}`);
  }
  if (config.trigger) {
    lines.push('  trigger:');
    lines.push(`    respondToAt: ${config.trigger.respondToAt}`);
    lines.push(`    respondToPrivate: ${config.trigger.respondToPrivate}`);
    lines.push('    prefixes:');
    for (const prefix of config.trigger.prefixes) {
      lines.push(`      - "${prefix}"`);
    }
    if (config.trigger.ignorePrefixes.length > 0) {
      lines.push('    ignorePrefixes:');
      for (const prefix of config.trigger.ignorePrefixes) {
        lines.push(`      - "${prefix}"`);
      }
    }
    lines.push(`    timeout: ${config.trigger.timeout}`);
  }

  if (config.sessions) {
    lines.push('  sessions:');
    lines.push(`    useDatabase: ${config.sessions.useDatabase}`);
    lines.push(`    maxHistory: ${config.sessions.maxHistory}`);
    lines.push(`    expireMs: ${config.sessions.expireMs}`);
  }

  if (config.context) {
    lines.push('  context:');
    lines.push(`    enabled: ${config.context.enabled}`);
    lines.push(`    maxRecentMessages: ${config.context.maxRecentMessages}`);
    lines.push(`    summaryThreshold: ${config.context.summaryThreshold}`);
    lines.push(`    keepAfterSummary: ${config.context.keepAfterSummary}`);
  }

  if (config.agent) {
    lines.push('  agent:');
    lines.push(`    execSecurity: ${config.agent.execSecurity}`);
    lines.push(`    execPreset: ${config.agent.execPreset}`);
    lines.push(`    phaseTrace: ${config.agent.phaseTrace}`);
    lines.push('    execAllowlist:');
    for (const command of config.agent.execAllowlist) {
      lines.push(`      - "${command}"`);
    }
  }

  lines.push(`  memoryMcp: ${config.memoryMcp ?? false}`);

  return lines.join('\n');
}

/**
 * 生成 TOML 格式的 AI 配置段
 */
export function generateAIConfigToml(config: AISetupConfig): string {
  if (!config.enabled) return '';

  const lines: string[] = [
    '',
    '[ai]',
    `defaultProvider = "${config.defaultProvider}"`,
    `memoryMcp = ${config.memoryMcp ?? false}`,
  ];

  if (config.providers) {
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      lines.push('', `[ai.providers.${name}]`);
      if (providerConfig.apiKey) lines.push(`apiKey = "${providerConfig.apiKey}"`);
      if (providerConfig.host) lines.push(`host = "${providerConfig.host}"`);
      if (providerConfig.models?.length) {
        lines.push(`models = ${JSON.stringify(providerConfig.models)}`);
      }
      if (providerConfig.baseUrl) lines.push(`baseUrl = "${providerConfig.baseUrl}"`);
    }
  }

  if (config.trigger) {
    lines.push('', '[ai.trigger]');
    lines.push(`respondToAt = ${config.trigger.respondToAt}`);
    lines.push(`respondToPrivate = ${config.trigger.respondToPrivate}`);
    lines.push(`prefixes = ${JSON.stringify(config.trigger.prefixes)}`);
    lines.push(`ignorePrefixes = ${JSON.stringify(config.trigger.ignorePrefixes)}`);
    lines.push(`timeout = ${config.trigger.timeout}`);
  }

  if (config.sessions) {
    lines.push('', '[ai.sessions]');
    lines.push(`useDatabase = ${config.sessions.useDatabase}`);
    lines.push(`maxHistory = ${config.sessions.maxHistory}`);
    lines.push(`expireMs = ${config.sessions.expireMs}`);
  }

  if (config.context) {
    lines.push('', '[ai.context]');
    lines.push(`enabled = ${config.context.enabled}`);
    lines.push(`maxRecentMessages = ${config.context.maxRecentMessages}`);
    lines.push(`summaryThreshold = ${config.context.summaryThreshold}`);
    lines.push(`keepAfterSummary = ${config.context.keepAfterSummary}`);
  }

  if (config.agent) {
    lines.push('', '[ai.agent]');
    lines.push(`execSecurity = "${config.agent.execSecurity}"`);
    lines.push(`execPreset = "${config.agent.execPreset}"`);
    lines.push(`execAllowlist = ${JSON.stringify(config.agent.execAllowlist)}`);
    lines.push(`phaseTrace = ${config.agent.phaseTrace}`);
  }

  return lines.join('\n');
}

/**
 * 生成 JSON 格式的 AI 配置段
 */
export function generateAIConfigJSON(config: AISetupConfig): string {
  if (!config.enabled) return '';

  const obj: any = {
    defaultProvider: config.defaultProvider,
    providers: {},
    sessions: config.sessions,
    context: config.context,
    agent: config.agent,
    trigger: config.trigger ? {
      ...config.trigger,
    } : undefined,
    memoryMcp: config.memoryMcp ?? false,
    mcpServers: config.mcpServers ?? [],
  };

  if (config.providers) {
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      const clean: any = {};
      if (providerConfig.apiKey) clean.apiKey = providerConfig.apiKey;
      if (providerConfig.host) clean.host = providerConfig.host;
      if (providerConfig.models) clean.models = providerConfig.models;
      if (providerConfig.baseUrl) clean.baseUrl = providerConfig.baseUrl;
      obj.providers[name] = clean;
    }
  }

  return `"ai": ${JSON.stringify(obj, null, 4).replace(/^/gm, '  ').trimStart()}`;
}
