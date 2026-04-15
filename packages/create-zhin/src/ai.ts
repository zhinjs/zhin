import inquirer from 'inquirer';
import chalk from 'chalk';

export interface AISetupConfig {
  enabled: boolean;
  defaultProvider?: string;
  providers?: Record<string, { apiKey?: string; host?: string; models?: string[]; baseUrl?: string }>;
  trigger?: { respondToAt: boolean; respondToPrivate: boolean; prefixes: string[] };
}

// 提供商信息
const PROVIDERS = [
  { name: 'OpenAI (GPT-4o, 推荐)', value: 'openai', defaultModel: 'gpt-4o' },
  { name: 'Anthropic (Claude)', value: 'anthropic', defaultModel: 'claude-sonnet-4-20250514' },
  { name: 'DeepSeek', value: 'deepseek', defaultModel: 'deepseek-chat' },
  { name: 'Moonshot (月之暗面)', value: 'moonshot', defaultModel: 'moonshot-v1-8k' },
  { name: '智谱 AI (GLM)', value: 'zhipu', defaultModel: 'glm-4' },
  { name: 'Ollama (本地部署)', value: 'ollama', defaultModel: 'qwen3:8b' },
] as const;

/**
 * AI 配置引导向导
 */
export async function configureAI(): Promise<AISetupConfig> {
  console.log('');
  console.log(chalk.blue('🤖 配置 AI 智能体'));

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

  // 选择提供商
  const { provider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: '选择 AI 提供商:',
      choices: PROVIDERS.map(p => ({ name: p.name, value: p.value })),
    }
  ]);

  const providerInfo = PROVIDERS.find(p => p.value === provider)!;
  let providerConfig: Record<string, any> = {};
  const envVarName = `AI_API_KEY`;

  if (provider === 'ollama') {
    // Ollama 本地部署
    const ollamaConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Ollama 地址:',
        default: 'http://localhost:11434',
      },
      {
        type: 'input',
        name: 'model',
        message: '模型名称:',
        default: providerInfo.defaultModel,
      }
    ]);
    providerConfig = {
      host: ollamaConfig.host,
      models: [ollamaConfig.model],
    };
  } else {
    // 云端提供商
    const cloudConfig = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: `${providerInfo.name.split(' (')[0]} API Key:`,
        validate: (input: string) => {
          if (!input.trim()) return 'API Key 不能为空（稍后可在 .env 文件中修改）';
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
        message: '自定义 API 地址（留空使用默认）:',
        default: '',
      }
    ]);

    providerConfig = {
      apiKey: `\${${envVarName}}`,
      models: [cloudConfig.model || providerInfo.defaultModel],
      ...(cloudConfig.baseUrl ? { baseUrl: cloudConfig.baseUrl } : {}),
    };

    // 保存实际 API Key 到环境变量映射
    (providerConfig as any).__envApiKey = cloudConfig.apiKey;
  }

  // 触发方式配置
  console.log('');
  console.log(chalk.blue('⚡ 配置 AI 触发方式'));

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
      message: '触发前缀（逗号分隔，如 #,AI:）:',
      default: '#',
    }
  ]);

  const prefixes = triggerConfig.prefixes
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);

  return {
    enabled: true,
    defaultProvider: provider,
    providers: {
      [provider]: providerConfig,
    },
    trigger: {
      respondToAt: triggerConfig.respondToAt,
      respondToPrivate: triggerConfig.respondToPrivate,
      prefixes: prefixes.length > 0 ? prefixes : ['#'],
    },
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

  const lines: string[] = [
    '',
    'ai:',
    '  enabled: true',
    `  defaultProvider: ${config.defaultProvider}`,
    '  providers:',
  ];

  if (config.providers) {
    for (const [name, providerConfig] of Object.entries(config.providers)) {
      lines.push(`    ${name}:`);
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

  if (config.trigger) {
    lines.push('  trigger:');
    lines.push('    enabled: true');
    lines.push(`    respondToAt: ${config.trigger.respondToAt}`);
    lines.push(`    respondToPrivate: ${config.trigger.respondToPrivate}`);
    lines.push('    prefixes:');
    for (const prefix of config.trigger.prefixes) {
      lines.push(`      - "${prefix}"`);
    }
    lines.push('    ignorePrefixes:');
    lines.push('      - /');
    lines.push('      - "!"');
  }

  return lines.join('\n');
}

/**
 * 生成 TOML 格式的 AI 配置段
 */
export function generateAIConfigToml(config: AISetupConfig): string {
  if (!config.enabled) return '';

  const lines: string[] = ['', '[ai]', 'enabled = true', `defaultProvider = "${config.defaultProvider}"`];

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
    lines.push('enabled = true');
    lines.push(`respondToAt = ${config.trigger.respondToAt}`);
    lines.push(`respondToPrivate = ${config.trigger.respondToPrivate}`);
    lines.push(`prefixes = ${JSON.stringify(config.trigger.prefixes)}`);
    lines.push('ignorePrefixes = ["/", "!"]');
  }

  return lines.join('\n');
}

/**
 * 生成 JSON 格式的 AI 配置段
 */
export function generateAIConfigJSON(config: AISetupConfig): string {
  if (!config.enabled) return '';

  const obj: any = {
    enabled: true,
    defaultProvider: config.defaultProvider,
    providers: {},
    trigger: config.trigger ? {
      enabled: true,
      ...config.trigger,
      ignorePrefixes: ['/', '!'],
    } : undefined,
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

  return `  "ai": ${JSON.stringify(obj, null, 4).replace(/^/gm, '  ').trimStart()},`;
}
