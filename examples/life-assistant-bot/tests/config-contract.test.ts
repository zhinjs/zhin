/**
 * life-assistant-bot 配置契约测试
 * 验证配置文件结构符合框架要求（无 LLM / 无实机）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8')

describe('life-assistant-bot 配置契约', () => {
  it('启用 AI', () => {
    expect(configText).toMatch(/ai:\s*\n/)
  })

  it('包含 sandbox 适配器', () => {
    expect(configText).toContain('@zhin.js/adapter-sandbox')
  })

  it('包含 host-router 和 host-api', () => {
    expect(configText).toContain('@zhin.js/host-router')
    expect(configText).toContain('@zhin.js/host-api')
  })

  it('包含 assistant 插件', () => {
    expect(configText).toMatch(/- assistant/)
  })

  it('配置了 AI provider', () => {
    expect(configText).toMatch(/providers:\s*\n/)
    expect(configText).toMatch(/ollama:/)
  })

  it('配置了 agent 绑定', () => {
    expect(configText).toMatch(/agents:\s*\n/)
    expect(configText).toMatch(/zhin:/)
    expect(configText).toMatch(/model:/)
  })

  it('配置了知识库', () => {
    expect(configText).toMatch(/knowledge:\s*\n/)
    expect(configText).toMatch(/baseDir:\s*knowledge/)
  })

  it('配置了触发器', () => {
    expect(configText).toMatch(/respondToAt:\s*true/)
    expect(configText).toMatch(/respondToPrivate:\s*true/)
    expect(configText).toMatch(/prefixes:/)
  })

  it('配置了安全策略', () => {
    expect(configText).toMatch(/execSecurity:\s*allowlist/)
    expect(configText).toMatch(/execApprovalMode:\s*ask/)
  })

  it('启用了 compaction', () => {
    expect(configText).toMatch(/compaction:\s*\n/)
    expect(configText).toMatch(/enabled:\s*true/)
    expect(configText).toMatch(/auto:\s*true/)
  })

  it('不包含 toolSearch（非 Advanced 编排）', () => {
    expect(configText).not.toMatch(/toolSearch:\s*true/)
  })

  it('不包含 MCP Mesh', () => {
    expect(configText).not.toMatch(/remoteAgents:/)
  })

  it('启用三层文件记忆，语义记忆默认关闭', () => {
    expect(configText).toMatch(/memory:\s*\n/)
    expect(configText).toMatch(/enabled:\s*true/)
    expect(configText).toMatch(/semantic:\s*\n/)
    expect(configText).toMatch(/semantic:\s*\n\s*enabled:\s*false/)
  })

  it('不使用已弃用 memoryMcp', () => {
    expect(configText).not.toMatch(/memoryMcp:/)
  })
})
