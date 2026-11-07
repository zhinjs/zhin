import { wizardText } from './messages.js';
import inquirer from 'inquirer';
import chalk from 'chalk';
import yaml from 'yaml';
import { formatEnvValue } from './env.js';

export interface AISetupConfig {
  enabled: boolean;
  agentProvider?: string;
  providers?: Record<string, {
    sdk?: string;
    apiKey?: string;
    host?: string;
    models?: string[];
    baseUrl?: string;
    capabilities?: { input?: readonly ('text' | 'image' | 'audio' | 'video' | 'file')[]; streaming?: boolean; toolCalling?: boolean };
  }>;
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
    presetModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
    defaultInput: ['text', 'image'] as const,
    hint: '需 OpenAI API Key；国内可用代理 baseUrl',
    keyPlaceholder: 'sk-...',
  },
  {
    name: 'Anthropic (Claude)',
    value: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    presetModels: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'],
    defaultInput: ['text', 'image'] as const,
    hint: '需 Anthropic API Key',
    keyPlaceholder: 'sk-ant-...',
  },
  {
    name: 'DeepSeek',
    value: 'deepseek',
    defaultModel: 'deepseek-chat',
    presetModels: ['deepseek-chat', 'deepseek-reasoner'],
    defaultInput: ['text'] as const,
    hint: '性价比高，国内直连',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '通义千问 (Qwen / DashScope)',
    value: 'qwen',
    defaultModel: 'qwen-plus',
    presetModels: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    defaultInput: ['text'] as const,
    hint: '阿里云百炼兼容模式，国内直连',
    keyPlaceholder: 'sk-...',
  },
  {
    name: 'Moonshot (月之暗面)',
    value: 'moonshot',
    defaultModel: 'moonshot-v1-8k',
    presetModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'],
    defaultInput: ['text'] as const,
    hint: 'Kimi 同款 API',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '智谱 AI (GLM)',
    value: 'zhipu',
    defaultModel: 'glm-4-flash',
    presetModels: ['glm-4-flash', 'glm-4-plus', 'glm-4.5'],
    defaultInput: ['text'] as const,
    hint: '国内直连，open.bigmodel.cn',
    keyPlaceholder: '...',
  },
  {
    name: 'SiliconFlow (硅基流动)',
    value: 'siliconflow',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    presetModels: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    defaultInput: ['text'] as const,
    hint: '国内聚合推理平台，api.siliconflow.cn',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '火山方舟 (Volcengine / 豆包)',
    value: 'volcengine',
    defaultModel: 'doubao-1-5-pro-32k-250115',
    presetModels: ['doubao-1-5-pro-32k-250115', 'deepseek-v3-250324'],
    defaultInput: ['text'] as const,
    hint: '字节火山引擎方舟 API',
    keyPlaceholder: '...',
  },
  {
    name: 'MiniMax (海螺 AI)',
    value: 'minimax',
    defaultModel: 'MiniMax-M2.7',
    presetModels: ['MiniMax-M2.7', 'MiniMax-Text-01'],
    defaultInput: ['text'] as const,
    hint: 'MiniMax 官方 API',
    keyPlaceholder: '...',
  },
  {
    name: 'OpenRouter',
    value: 'openrouter',
    defaultModel: 'openai/gpt-4o-mini',
    presetModels: ['openai/gpt-4o-mini', 'anthropic/claude-3.7-sonnet', 'deepseek/deepseek-chat'],
    defaultInput: ['text', 'image'] as const,
    hint: '海外多模型聚合路由，openrouter.ai',
    keyPlaceholder: 'sk-or-...',
  },
  {
    name: 'Google (Gemini)',
    value: 'google',
    defaultModel: 'gemini-2.5-flash',
    presetModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultInput: ['text', 'image'] as const,
    hint: '需 Google AI API Key',
    keyPlaceholder: 'AIza...',
  },
  {
    name: 'Ollama (本地部署)',
    value: 'ollama',
    defaultModel: 'qwen3:8b',
    presetModels: ['qwen3:8b', 'llama3.2:latest', 'deepseek-r1:8b'],
    defaultInput: ['text'] as const,
    hint: '本地运行，无需 API Key；先 ollama pull 模型',
    keyPlaceholder: '',
  },
  {
    name: 'OpenAI 兼容接口 (vLLM / OneAPI / SiliconFlow 等)',
    value: 'openai-compatible',
    defaultModel: '',
    presetModels: [] as const,
    defaultInput: ['text'] as const,
    hint: '任何兼容 OpenAI API 的服务，需填 baseUrl',
    keyPlaceholder: 'sk-...',
  },
] as const;

export function providerSdkFor(name: string): string {
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
    case 'minimax':
      return 'minimax';
    case 'openai-compatible':
    case 'moonshot':
    case 'zhipu':
    case 'qwen':
    case 'siliconflow':
    case 'openrouter':
    case 'volcengine':
      return 'openai-compatible';
    default:
      return 'openai';
  }
}

/**
 * OpenAI-compatible Services require an explicit endpoint. The wizard offers
 * known product addresses; the selected Driver validates them during plan review.
 */
export const PROVIDER_DEFAULT_BASE_URLS: Readonly<Record<string, string>> = Object.freeze({
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  moonshot: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
});

export function resolveAISetupAgentProvider(config: Pick<AISetupConfig, 'agentProvider' | 'providers'>): string {
  return config.agentProvider
    ?? Object.keys(config.providers ?? {})[0]
    ?? 'openai';
}

/** Produce an import proposal, never a second startup model authority. */
export function materializeAIPlan(config: AISetupConfig): Record<string, unknown> {
  const primary = resolveAISetupAgentProvider(config);
  const services: Record<string, unknown> = {}, accounts: Record<string, unknown> = {}, profiles: Record<string, unknown> = {};
  let chosen: string | undefined;
  for (const [name, provider] of Object.entries(config.providers ?? {})) {
    const driver = provider.sdk ?? providerSdkFor(name);
    const models = provider.models?.filter(model => model.trim()) ?? [];
    if (!models.length) throw new Error(`A model ID is required for ${name}`);
    const protocol = driver === 'anthropic' || driver === 'minimax' ? 'anthropic-messages' : driver === 'google' ? 'google-generate-content' : 'openai-chat';
    const baseUrl = provider.baseUrl ?? provider.host ?? PROVIDER_DEFAULT_BASE_URLS[name];
    services[name] = { driver, ...(baseUrl ? { options: { baseUrl } } : {}),
      models: Object.fromEntries(models.map(id => [id, { id, kinds: ['language'], protocol, input: provider.capabilities?.input ?? ['text'], ...(provider.capabilities?.streaming !== undefined ? { streaming: provider.capabilities.streaming } : {}), ...(provider.capabilities?.toolCalling !== undefined ? { toolCalling: provider.capabilities.toolCalling } : {}) }])) };
    const env = provider.apiKey?.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u);
    if (provider.apiKey && !env) throw new Error('AI setup keys must use an environment reference');
    accounts[name] = { service: name, auth: driver === 'ollama' && !provider.apiKey
      ? { method: 'none' } : { method: 'api-key', ...(env ? { source: `env://${env[1]}` } : {}) } };
    for (const model of models) {
      const profile = `${name}:${model}`; profiles[profile] = { account: name, model };
      if (name === primary && !chosen) chosen = profile;
    }
  }
  if (!chosen) throw new Error('The selected AI service has no model');
  return { version: 1, services, accounts, profiles, purposes: { chat: { profile: chosen } } };
}

/** Startup policies only. Model definitions are written to the separate proposal. */
export function materializeAIConfig(config: AISetupConfig): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    sessions: config.sessions, context: config.context, agent: config.agent,
    trigger: config.trigger ? { ...config.trigger } : undefined,
    memoryMcp: config.memoryMcp ?? false, mcpServers: config.mcpServers ?? [],
  };
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
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
export async function configureAI(locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<AISetupConfig> {
  console.log('');
  console.log(chalk.blue(wizardText(locale, "🤖 配置 AI 智能体")));
  console.log(chalk.gray(wizardText(locale, "  启用后将自动写入 package.json：@zhin.js/agent、zod、ai、所选 @ai-sdk/*（启用 memory MCP 时另加 @modelcontextprotocol/sdk）。")));
  console.log(chalk.gray(wizardText(locale, "  会话持久化默认开启，将自动配置 SQLite 数据库（若尚未选择）。")));

  const { enableAI } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableAI',
      message: wizardText(locale, "是否启用 AI 智能体？（大模型对话 + 工具调用）"),
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
      message: wizardText(locale, "选择 AI 提供商:"),
      choices: PROVIDERS.map(p => ({
        name: `${wizardText(locale, p.name)} — ${wizardText(locale, p.hint)}`,
        value: p.value,
      })),
      pageSize: 10,
    }
  ]);

  const providerInfo = PROVIDERS.find(p => p.value === provider)!;
  console.log(chalk.gray(`  ${providerInfo.hint}`));

  let providerConfig: Record<string, any> = {};
  const envVarName = `AI_API_KEY`;
  let selectedModelChoice: string = '__custom__';

  if (provider === 'ollama') {
    const { host, modelPreset } = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: wizardText(locale, "Ollama 地址:"),
        default: 'http://127.0.0.1:11434',
        validate: (input: string) => {
          if (!input.trim()) return wizardText(locale, "地址不能为空");
          if (!/^https?:\/\//.test(input.trim())) return wizardText(locale, "请输入 http:// 或 https:// 开头的地址");
          return true;
        },
      },
      {
        type: 'select',
        name: 'modelPreset',
        message: wizardText(locale, "模型名称（需已 ollama pull）:"),
        choices: [
          ...providerInfo.presetModels.map(m => ({ name: m, value: m })),
          { name: locale === 'en' ? 'Custom model ID...' : '自定义模型 ID...', value: '__custom__' },
        ],
        default: providerInfo.defaultModel,
      },
    ]);
    selectedModelChoice = modelPreset;
    let resolvedModel = modelPreset;
    if (modelPreset === '__custom__') {
      const { customModel } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customModel',
          message: wizardText(locale, "模型名称（需已 ollama pull）:"),
          default: providerInfo.defaultModel,
          validate: (input: string) => (input.trim() ? true : wizardText(locale, "模型名不能为空")),
        },
      ]);
      resolvedModel = customModel.trim();
    }
    providerConfig = {
      host: host.trim(),
      models: [resolvedModel],
    };
  } else {
    const defaultBaseUrl = PROVIDER_DEFAULT_BASE_URLS[provider];
    const requireBaseUrl = providerSdkFor(provider) === 'openai-compatible';
    const { apiKey } = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: `${providerInfo.name.split(' (')[0]} API Key:`,
        validate: (input: string) => {
          if (!input.trim()) return wizardText(locale, "API Key 不能为空（可稍后在 .env 中填写 AI_API_KEY）");
          return true;
        },
      },
    ]);

    let resolvedModel = providerInfo.defaultModel;
    if (providerInfo.presetModels.length > 0) {
      const { modelPreset } = await inquirer.prompt([
        {
          type: 'select',
          name: 'modelPreset',
          message: wizardText(locale, "模型名称:"),
          choices: [
            ...providerInfo.presetModels.map(m => ({ name: m, value: m })),
            { name: locale === 'en' ? 'Custom model ID...' : '自定义模型 ID...', value: '__custom__' },
          ],
          default: providerInfo.defaultModel,
        },
      ]);
      selectedModelChoice = modelPreset;
      resolvedModel = modelPreset;
    } else {
      selectedModelChoice = '__custom__';
    }

    if (selectedModelChoice === '__custom__') {
      const { customModel } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customModel',
          message: provider === 'openai-compatible'
            ? wizardText(locale, "模型名称（服务端实际部署的模型 ID）:")
            : wizardText(locale, "模型名称:"),
          default: providerInfo.defaultModel || undefined,
          validate: (input: string) => (input.trim() ? true : wizardText(locale, "模型名称不能为空")),
        },
      ]);
      resolvedModel = customModel.trim() || providerInfo.defaultModel;
    }

    const { baseUrl } = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: requireBaseUrl
          ? wizardText(locale, "API 地址（openai-compatible 必填，如 https://api.example.com/v1）:")
          : wizardText(locale, "自定义 API 地址（留空使用官方默认）:"),
        default: defaultBaseUrl ?? '',
        validate: requireBaseUrl
          ? (input: string) => {
              if (!input.trim()) return wizardText(locale, "baseUrl 不能为空（openai-compatible SDK 必须指定 API 地址）");
              if (!/^https?:\/\//.test(input.trim())) return wizardText(locale, "请输入 http:// 或 https:// 开头的地址");
              return true;
            }
          : undefined,
      },
    ]);

    providerConfig = {
      apiKey: `\${${envVarName}}`,
      models: [resolvedModel],
      ...(baseUrl?.trim() ? { baseUrl: baseUrl.trim() } : {}),
    };

    (providerConfig as any).__envApiKey = apiKey.trim();
  }

  console.log('');
  if (selectedModelChoice !== '__custom__') {
    providerConfig.capabilities = {
      input: providerInfo.defaultInput ? [...providerInfo.defaultInput] : ['text'],
      toolCalling: true,
      streaming: true,
    };
  } else {
    const featureChoices = [
      { name: wizardText(locale, "未知"), value: 'unknown' },
      { name: wizardText(locale, "支持"), value: 'yes' },
      { name: wizardText(locale, "不支持"), value: 'no' },
    ];
    const features = await inquirer.prompt([
      { type: 'select', name: 'toolCalling', message: wizardText(locale, "模型支持工具调用？"), choices: featureChoices },
      { type: 'select', name: 'streaming', message: wizardText(locale, "模型支持流式输出？"), choices: featureChoices },
      { type: 'checkbox', name: 'input', message: wizardText(locale, "模型支持的输入类型："),
        choices: ['text', 'image', 'audio', 'video', 'file'].map(value => ({
          name: value,
          value,
          ...(value === 'text'
            ? { checked: true, disabled: true }
            : (providerInfo.defaultInput as readonly string[]).includes(value)
              ? { checked: true }
              : {}),
        })) },
    ]);
    providerConfig.capabilities = { input: ['text', ...(features.input ?? []).filter((value: string) => value !== 'text')],
      ...(features.toolCalling === 'unknown' ? {} : { toolCalling: features.toolCalling === 'yes' }),
      ...(features.streaming === 'unknown' ? {} : { streaming: features.streaming === 'yes' }) };
  }
  console.log(chalk.blue(wizardText(locale, "⚡ 配置 AI 触发方式")));
  console.log(chalk.gray(wizardText(locale, "  决定 Endpoint 何时自动调用大模型；命令（/ 开头）不会被 AI 拦截。")));

  const triggerConfig = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'respondToAt',
      message: wizardText(locale, "响应 @机器人 的消息？"),
      default: true,
    },
    {
      type: 'confirm',
      name: 'respondToPrivate',
      message: wizardText(locale, "响应私聊消息？"),
      default: true,
    },
    {
      type: 'input',
      name: 'prefixes',
      message: wizardText(locale, "触发前缀（逗号分隔，如 #,ai:）:"),
      default: '#',
    }
  ]);

  const prefixes = triggerConfig.prefixes
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);

  console.log('');
  console.log(chalk.blue(wizardText(locale, "🛡️  配置 Agent 安全与能力")));
  console.log(chalk.gray(wizardText(locale, "  生产环境建议 execSecurity: deny；开发调试可选 allowlist。")));

  const agentConfig = await inquirer.prompt([
    {
      type: 'select',
      name: 'execSecurity',
      message: wizardText(locale, "命令执行安全策略:"),
      choices: [
        { name: wizardText(locale, "deny — 禁止执行 shell（推荐）"), value: 'deny' },
        { name: wizardText(locale, "allowlist — 仅允许白名单命令"), value: 'allowlist' },
        { name: wizardText(locale, "full — 允许任意命令（仅本地调试）"), value: 'full' },
      ],
      default: 'deny',
    },
    {
      type: 'confirm',
      name: 'memoryMcp',
      message: wizardText(locale, "启用本地知识图谱 memory MCP？（data/knowledge-graph.jsonl）"),
      default: false,
    },
    {
      type: 'confirm',
      name: 'phaseTrace',
      message: wizardText(locale, "输出 Agent 阶段日志（便于排障）？"),
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
    agentProvider: provider,
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
export function generateAIEnvVars(config: AISetupConfig, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (!config.enabled || !config.providers) return '';

  const envVars: string[] = ['', wizardText(locale, "# AI 配置")];

  for (const [, providerConfig] of Object.entries(config.providers)) {
    const realKey = (providerConfig as any).__envApiKey;
    if (realKey) {
      envVars.push(`AI_API_KEY=${formatEnvValue(realKey)}`);
    }
  }

  return envVars.length > 1 ? envVars.join('\n') : '';
}

/**
 * 生成 YAML 格式的 AI 配置段
 */
export function generateAIConfigYaml(config: AISetupConfig): string {
  return config.enabled ? `\n${yaml.stringify({ ai: materializeAIConfig(config) })}` : '';
}

/**
 * 生成 JSON 格式的 AI 配置段
 */
export function generateAIConfigJSON(config: AISetupConfig): string {
  if (!config.enabled) return '';

  const obj = materializeAIConfig(config);

  return `"ai": ${JSON.stringify(obj, null, 4).replace(/^/gm, '  ').trimStart()}`;
}
