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

  it('uses hierarchical Sandbox child config', () => {
    expect(configText).toMatch(/plugins:\s*\n\s+sandbox:/)
    expect(configText).toMatch(/context:\s*sandbox/)
  })

  it('uses the Plugin Runtime manifest and conventional capabilities', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'))
    expect(manifest.scripts.dev).toBe('zhin runtime start')
    expect(manifest.zhin.entry).toBe('./plugin.ts')
    expect(fs.existsSync(path.join(botRoot, 'commands/remind/[text:string].ts'))).toBe(true)
    expect(fs.existsSync(path.join(botRoot, 'tools/get-current-time.ts'))).toBe(true)
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
