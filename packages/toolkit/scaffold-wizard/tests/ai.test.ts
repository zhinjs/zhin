import { describe, it, expect } from 'vitest'
import { generateAIConfigJSON, generateAIConfigToml, generateAIConfigYaml, RECOMMENDED_AI_DEFAULTS } from '../src/ai'
import type { AISetupConfig } from '../src/ai'

const aiConfig: AISetupConfig = {
  enabled: true,
  defaultProvider: 'openai',
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
    expect(yaml).toContain('toolSearch: false')
    expect(yaml).toContain('ignorePrefixes:')
    expect(yaml).toContain('memoryMcp: false')
  })

  it('generates parseable JSON AI config', () => {
    const json = `{${generateAIConfigJSON(aiConfig)}}`
    const parsed = JSON.parse(json)

    expect(parsed.ai.defaultProvider).toBe('openai')
    expect(parsed.ai.sessions.useDatabase).toBe(true)
    expect(parsed.ai.context.maxRecentMessages).toBe(100)
    expect(parsed.ai.agent.execSecurity).toBe('deny')
    expect(parsed.ai.trigger.timeout).toBe(60000)
  })

  it('keeps top-level AI TOML values in the ai table', () => {
    const toml = generateAIConfigToml(aiConfig)

    expect(toml).toContain('[ai]\ndefaultProvider = "openai"\nmemoryMcp = false')
    expect(toml).toContain('[ai.agent]')
    expect(toml).toContain('toolSearch = false')
  })
})
