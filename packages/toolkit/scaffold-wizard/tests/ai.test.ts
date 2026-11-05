import { describe, it, expect } from 'vitest'
import { generateAIConfigJSON, generateAIConfigYaml, generateAIEnvVars, PROVIDER_DEFAULT_BASE_URLS, providerSdkFor, RECOMMENDED_AI_DEFAULTS, materializeAIPlan, type AISetupConfig } from '../src/ai';

const aiConfig: AISetupConfig = {
  enabled: true,
  agentProvider: 'openai',
  providers: {
    openai: {
      apiKey: '${AI_API_KEY}',
      models: ['gpt-4o'],
    },
  },
  sessions: RECOMMENDED_AI_DEFAULTS.sessions,
  context: RECOMMENDED_AI_DEFAULTS.context,
  agent: RECOMMENDED_AI_DEFAULTS.agent,
  trigger: {
    respondToAt: true,
    respondToPrivate: true,
    prefixes: ['#'],
    ignorePrefixes: RECOMMENDED_AI_DEFAULTS.trigger.ignorePrefixes,
    timeout: RECOMMENDED_AI_DEFAULTS.trigger.timeout,
  },
  memoryMcp: false,
  mcpServers: [],
}

describe('create-zhin ai config', () => {
  it('generates recommended YAML defaults for sessions, context, agent, and trigger', () => {
    const yaml = generateAIConfigYaml(aiConfig)

    expect(yaml).toContain('sessions:')
    expect(yaml).toContain('useDatabase: true')
    expect(yaml).toContain('context:')
    expect(yaml).toContain('summaryThreshold: 50')
    expect(yaml).toContain('agent:')
    expect(yaml).toContain('execSecurity: deny')
    expect(yaml).not.toContain('plan:')
    expect(materializeAIPlan(aiConfig)).toMatchObject({ services: { openai: { driver: 'openai' } } })
    expect(yaml).not.toContain('toolSearch:')
    expect(yaml).not.toContain('defaultProvider:')
    expect(yaml).toContain('ignorePrefixes:')
    expect(yaml).toContain('memoryMcp: false')
  })

  it('generates parseable JSON AI config', () => {
    const json = `{${generateAIConfigJSON(aiConfig)}}`
    const parsed = JSON.parse(json)

    expect(parsed.ai.defaultProvider).toBeUndefined()
    expect(parsed.ai).not.toHaveProperty('plan')
    expect(materializeAIPlan(aiConfig)).toMatchObject({ purposes: { chat: { profile: 'openai:gpt-4o' } }, services: { openai: { driver: 'openai' } }, accounts: { openai: { auth: { source: 'env://AI_API_KEY' } } } })
    expect(parsed.ai.sessions.useDatabase).toBe(true)
    expect(parsed.ai.context.maxRecentMessages).toBe(100)
    expect(parsed.ai.agent.execSecurity).toBe('deny')
    expect(parsed.ai.trigger.timeout).toBe(60000)
  })

})

describe('openai-compatible and domestic providers baseUrl & drivers', () => {
  it('requires prefilled official baseUrl for zhipu/moonshot/qwen/siliconflow/openrouter/volcengine', () => {
    expect(PROVIDER_DEFAULT_BASE_URLS.zhipu).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(PROVIDER_DEFAULT_BASE_URLS.moonshot).toBe('https://api.moonshot.cn/v1')
    expect(PROVIDER_DEFAULT_BASE_URLS.qwen).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(PROVIDER_DEFAULT_BASE_URLS.siliconflow).toBe('https://api.siliconflow.cn/v1')
    expect(PROVIDER_DEFAULT_BASE_URLS.openrouter).toBe('https://openrouter.ai/api/v1')
    expect(PROVIDER_DEFAULT_BASE_URLS.volcengine).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(providerSdkFor('zhipu')).toBe('openai-compatible')
    expect(providerSdkFor('moonshot')).toBe('openai-compatible')
    expect(providerSdkFor('qwen')).toBe('openai-compatible')
    expect(providerSdkFor('siliconflow')).toBe('openai-compatible')
    expect(providerSdkFor('openrouter')).toBe('openai-compatible')
    expect(providerSdkFor('volcengine')).toBe('openai-compatible')
    expect(providerSdkFor('minimax')).toBe('minimax')
    expect(PROVIDER_DEFAULT_BASE_URLS.openai).toBeUndefined()
  })

  it('materializes qwen and minimax plans with correct driver, protocol, and default baseUrl fallback', () => {
    const plan = materializeAIPlan({
      enabled: true,
      agentProvider: 'qwen',
      providers: {
        qwen: { apiKey: '${AI_API_KEY}', models: ['qwen-plus'] },
        minimax: { apiKey: '${AI_API_KEY}', models: ['MiniMax-M2.7'] },
      },
    })
    expect(plan).toMatchObject({
      services: {
        qwen: {
          driver: 'openai-compatible',
          options: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
          models: { 'qwen-plus': { protocol: 'openai-chat' } },
        },
        minimax: {
          driver: 'minimax',
          models: { 'MiniMax-M2.7': { protocol: 'anthropic-messages' } },
        },
      },
      purposes: { chat: { profile: 'qwen:qwen-plus' } },
    })
  })
})

describe('generateAIEnvVars', () => {
  it('escapes API keys containing special characters', () => {
    const env = generateAIEnvVars({
      enabled: true,
      providers: {
        openai: { apiKey: '${AI_API_KEY}', __envApiKey: 'sk-with space#hash' },
      },
    } as unknown as AISetupConfig)
    expect(env).toContain('AI_API_KEY="sk-with space#hash"')
  })

  it('returns empty string when disabled', () => {
    expect(generateAIEnvVars({ enabled: false })).toBe('')
  })
})
