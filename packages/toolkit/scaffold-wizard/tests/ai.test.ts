import { describe, it, expect } from 'vitest'
import { generateAIConfigJSON, generateAIConfigToml, generateAIConfigYaml, generateAIEnvVars, PROVIDER_DEFAULT_BASE_URLS, providerSdkFor, RECOMMENDED_AI_DEFAULTS, type AISetupConfig } from '../src/ai';

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
    expect(yaml).toContain('agents:')
    expect(yaml).toContain('provider: openai')
    expect(yaml).toContain('sdk: openai')
    expect(yaml).not.toContain('toolSearch:')
    expect(yaml).not.toContain('defaultProvider:')
    expect(yaml).toContain('ignorePrefixes:')
    expect(yaml).toContain('memoryMcp: false')
  })

  it('generates parseable JSON AI config', () => {
    const json = `{${generateAIConfigJSON(aiConfig)}}`
    const parsed = JSON.parse(json)

    expect(parsed.ai.defaultProvider).toBeUndefined()
    expect(parsed.ai.agents.zhin.provider).toBe('openai')
    expect(parsed.ai.providers.openai.sdk).toBe('openai')
    expect(parsed.ai.sessions.useDatabase).toBe(true)
    expect(parsed.ai.context.maxRecentMessages).toBe(100)
    expect(parsed.ai.agent.execSecurity).toBe('deny')
    expect(parsed.ai.trigger.timeout).toBe(60000)
  })

  it('keeps top-level AI TOML values in the ai table', () => {
    const toml = generateAIConfigToml(aiConfig)

    expect(toml).toContain('[ai]\nmemoryMcp = false')
    expect(toml).toContain('[ai.providers.openai]\nsdk = "openai"')
    expect(toml).toContain('[ai.agents.zhin]\nprovider = "openai"')
    expect(toml).toContain('[ai.agent]')
    expect(toml).not.toContain('toolSearch')
    expect(toml).not.toContain('defaultProvider')
  })

  it('accepts legacy defaultProvider input without emitting it', () => {
    const json = `{${generateAIConfigJSON({
      enabled: true,
      defaultProvider: 'ollama',
      providers: { ollama: { host: 'http://127.0.0.1:11434' } },
    })}}`
    const parsed = JSON.parse(json)

    expect(parsed.ai.defaultProvider).toBeUndefined()
    expect(parsed.ai.providers.ollama.sdk).toBe('ollama')
    expect(parsed.ai.agents.zhin.provider).toBe('ollama')
  })
})

describe('openai-compatible providers baseUrl', () => {
  it('requires prefilled official baseUrl for zhipu/moonshot (runtime rejects empty baseUrl)', () => {
    expect(PROVIDER_DEFAULT_BASE_URLS.zhipu).toBe('https://open.bigmodel.cn/api/paas/v4')
    expect(PROVIDER_DEFAULT_BASE_URLS.moonshot).toBe('https://api.moonshot.cn/v1')
    // 这两个 provider 的 sdk 为 openai-compatible，runtime 无 baseUrl 无法建 provider
    expect(providerSdkFor('zhipu')).toBe('openai-compatible')
    expect(providerSdkFor('moonshot')).toBe('openai-compatible')
    expect(PROVIDER_DEFAULT_BASE_URLS.openai).toBeUndefined()
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
