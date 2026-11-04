/**
 * life-assistant-bot 配置契约测试
 * 验证配置文件结构符合框架要求（无 LLM / 无实机）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { reviewAIPlan } from '../../../tests/helpers/review-ai-plan.js'

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8')
const plan = parse(fs.readFileSync(path.join(botRoot, 'ai.plan.yml'), 'utf8'))

describe('life-assistant-bot 配置契约', () => {
  it('启用 AI', () => {
    expect(configText).toMatch(/ai:\s*\n/)
  })

  it('uses hierarchical Sandbox child config', () => {
    expect(configText).toMatch(/plugins:\s*\n\s+sandbox:/)
    expect(configText).toMatch(/id:\s*assistant/)
    expect(configText).not.toMatch(/context:\s*sandbox/)
  })

  it('uses the Plugin Runtime manifest and conventional capabilities', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(botRoot, 'package.json'), 'utf8'))
    expect(manifest.scripts.dev).toBe('zhin runtime start --watch source config')
    expect(manifest.zhin.entry).toBe('./plugin.ts')
    expect(fs.existsSync(path.join(botRoot, 'commands/remind/[text]/index.ts'))).toBe(true)
    expect(fs.existsSync(path.join(
      botRoot,
      'skills/daily-context/tools/get-current-time/index.ts',
    ))).toBe(true)
    expect(manifest.zhin.features.map((entry: { package: string }) => entry.package))
      .toContain('@zhin.js/skill')
  })

  it('通过独立提案配置本地服务，不在启动文件定义模型权威', async () => {
    expect(plan.services.ollama).toMatchObject({ driver: 'ollama', options: { baseUrl: 'http://localhost:11434' } })
    expect(plan.accounts.ollama).toEqual({ service: 'ollama', auth: { method: 'none' } })
    expect(parse(configText).ai).not.toHaveProperty('providers')
    expect(parse(configText).ai).not.toHaveProperty('plan')
    const reviewed = await reviewAIPlan(plan)
    expect(reviewed.graph.services[reviewed.bindings.services.ollama].models['qwen3:8b']).toMatchObject({ input: ['text'], toolCalling: true })
  })

  it('显式导入后聊天用途绑定到提案中的真实模型', async () => {
    const reviewed = await reviewAIPlan(plan)
    const selected = reviewed.graph.profiles[reviewed.graph.purposes.defaults.chat!]
    expect(selected.model).toBe('qwen3:8b')
    expect(selected.accountId).toBe(reviewed.bindings.accounts.ollama)
    expect(parse(configText).ai).not.toHaveProperty('profiles')
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
