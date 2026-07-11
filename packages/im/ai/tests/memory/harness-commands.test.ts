/**
 * IM Harness 命令集成测试 — 覆盖 /tree、/reset、/compact 核心路径。
 *
 * 使用 MemoryContextRepository（无外部依赖），测试 ContextRepository 的
 * listBranchPoints / jumpToBranchIndex / archiveSession / resolveCompactionAnchorId
 * 操作，这些是 IM 命令的底层实现。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryContextRepository, type MemoryContextRepository } from '../../src/memory/context-repository.js';

import type { MemoryAgentSessionStore } from '../../src/memory/agent-session-store.js'
import { createUserMessage, EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage } from '../../src/llm/types/agent-message.js';

let repo: MemoryContextRepository
let sessionStore: MemoryAgentSessionStore
let sessionId: string
const SESSION_KEY = 'test:private:user1'

function assistantMsg(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'mock',
    model: 'mock-model',
    usage: EMPTY_TOKEN_USAGE,
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

/** 创建一个有 3 轮对话（user + assistant × 3）的线性会话 */
async function seedLinearConversation(): Promise<void> {
  const messages: AgentMessage[][] = [
    [createUserMessage('你好，我是张三')],
    [assistantMsg('你好张三！有什么可以帮你的？')],
    [createUserMessage('今天天气怎么样')],
    [assistantMsg('今天北京晴，25°C')],
    [createUserMessage('推荐一个菜谱')],
    [assistantMsg('推荐红烧肉：五花肉切块焯水，炒糖色...')],
  ]
  for (const batch of messages) {
    await repo.appendMessages(sessionId, batch)
  }
}

describe('IM Harness — /tree 核心路径', () => {
  beforeEach(async () => {
    const created = createMemoryContextRepository()
    repo = created.repository
    sessionStore = created.sessionStore
    const session = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    sessionId = session.session_id
  })

  it('空会话无分支点', async () => {
    const points = await repo.listBranchPoints(sessionId)
    expect(points).toHaveLength(0)
  })

  it('线性对话列出所有 user 消息作为分支点', async () => {
    await seedLinearConversation()
    const points = await repo.listBranchPoints(sessionId)

    expect(points.length).toBeGreaterThanOrEqual(3)
    // 每个分支点对应一条 user 消息
    for (const p of points) {
      expect(p.index).toBeGreaterThan(0)
      expect(p.messageId).toBeGreaterThan(0)
      expect(typeof p.preview).toBe('string')
    }
  })

  it('分支点 preview 包含消息内容', async () => {
    await seedLinearConversation()
    const points = await repo.listBranchPoints(sessionId)

    // 第一个 user 消息的 preview 应包含内容
    expect(points[0].preview).toContain('张三')
  })

  it('会话树分支：从中间分叉后两条路径都可遍历', async () => {
    await seedLinearConversation()

    // 获取第一个 user 消息的 id
    const rows = await repo.loadMessageRows(sessionId)
    const firstUserRow = rows.find(r => r.role === 'user')
    expect(firstUserRow).toBeDefined()

    // 回到第一条 user 消息，创建新分支
    await repo.setActiveLeaf(sessionId, firstUserRow!.id!)
    await repo.appendMessages(sessionId, [createUserMessage('换个话题，聊聊音乐')])
    await repo.appendMessages(sessionId, [assistantMsg('好的！你喜欢什么类型的音乐？')])

    // 现在有两条路径：原始路径和新分支
    const allRows = await repo.loadMessageRows(sessionId)
    // 活跃路径应该只包含新分支的消息
    const { buildActivePathRows } = await import('../../src/memory/session-tree.js')
    const activePath = buildActivePathRows(allRows)
    const activeTexts = activePath.map(r => {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
      return payload.content?.[0]?.text || ''
    })
    expect(activeTexts).toContain('换个话题，聊聊音乐')
    expect(activeTexts).not.toContain('今天天气怎么样')
  })
})

describe('IM Harness — /tree N 跳转', () => {
  beforeEach(async () => {
    const created = createMemoryContextRepository()
    repo = created.repository
    sessionStore = created.sessionStore
    const session = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    sessionId = session.session_id
  })

  it('jumpToBranchIndex 跳转到指定分支点', async () => {
    await seedLinearConversation()
    const points = await repo.listBranchPoints(sessionId)
    expect(points.length).toBeGreaterThanOrEqual(2)

    // 跳转到第一个分支点
    const result = await repo.jumpToBranchIndex(sessionId, 1)
    expect(result.ok).toBe(true)
    expect(result.message).toBeTruthy()
  })

  it('jumpToBranchIndex 无效索引返回失败', async () => {
    await seedLinearConversation()
    const result = await repo.jumpToBranchIndex(sessionId, 999)
    expect(result.ok).toBe(false)
  })

  it('跳转后新分支与原分支独立', async () => {
    await seedLinearConversation()
    const points = await repo.listBranchPoints(sessionId)

    // 跳转到第 2 个 user 消息
    await repo.jumpToBranchIndex(sessionId, 2)

    // 在新位置追加消息
    await repo.appendMessages(sessionId, [createUserMessage('新分支消息')])
    await repo.appendMessages(sessionId, [assistantMsg('新分支回复')])

    // 活跃路径应包含新分支
    const rows = await repo.loadMessageRows(sessionId)
    const { buildActivePathRows } = await import('../../src/memory/session-tree.js')
    const activePath = buildActivePathRows(rows)
    const activeTexts = activePath.map(r => {
      const payload = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
      return payload.content?.[0]?.text || ''
    })
    expect(activeTexts).toContain('新分支消息')
  })
})

describe('IM Harness — /reset 归档', () => {
  beforeEach(async () => {
    const created = createMemoryContextRepository()
    repo = created.repository
    sessionStore = created.sessionStore
    const session = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    sessionId = session.session_id
  })

  it('归档空会话返回 true（会话已创建即可归档）', async () => {
    // getOrCreateActive 在 beforeEach 已创建会话，即使无消息也可归档
    const ok = await repo.archiveSession(SESSION_KEY)
    expect(ok).toBe(true)
  })

  it('归档不存在的会话返回 false', async () => {
    const ok = await repo.archiveSession('nonexistent:key')
    expect(ok).toBe(false)
  })

  it('归档后旧 session 不再是 active', async () => {
    await seedLinearConversation()
    const ok = await repo.archiveSession(SESSION_KEY)
    expect(ok).toBe(true)

    // 旧 sessionId 应该不再产生新消息（归档后 getOrCreateActive 创建新 epoch）
    const newSession = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    expect(newSession.session_id).not.toBe(sessionId)
  })

  it('归档后新 epoch 从空上下文开始', async () => {
    await seedLinearConversation()
    await repo.archiveSession(SESSION_KEY)

    const newSession = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    const ctx = await repo.loadContext(newSession.session_id)
    expect(ctx.messages).toHaveLength(0)
  })

  it('归档后旧 epoch 消息仍可读取', async () => {
    await seedLinearConversation()
    await repo.archiveSession(SESSION_KEY)

    const ctx = await repo.loadContext(sessionId)
    expect(ctx.messages.length).toBeGreaterThan(0)
    // 第一条消息应该是 user 的
    expect(ctx.messages[0].role).toBe('user')
  })

  it('连续归档产生不同 epoch', async () => {
    await seedLinearConversation()
    await repo.archiveSession(SESSION_KEY)

    const s2 = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    await repo.appendMessages(s2.session_id, [createUserMessage('第二轮')])
    await repo.archiveSession(SESSION_KEY)

    const s3 = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    expect(s3.session_id).not.toBe(sessionId)
    expect(s3.session_id).not.toBe(s2.session_id)
  })
})

describe('IM Harness — /compact 压缩锚点', () => {
  beforeEach(async () => {
    const created = createMemoryContextRepository({ tailMessageLimit: 100 })
    repo = created.repository
    sessionStore = created.sessionStore
    const session = await sessionStore.getOrCreateActive({
      session_key: SESSION_KEY,
      platform: 'test',
      endpoint_id: 'bot1',
      scene_id: 'user1',
      scene_type: 'private',
    })
    sessionId = session.session_id
  })

  it('少量消息无需压缩', async () => {
    await repo.appendMessages(sessionId, [createUserMessage('hi')])
    await repo.appendMessages(sessionId, [assistantMsg('hello')])

    // resolveCompactionAnchorId 返回 undefined 表示无需压缩
    const anchor = await repo.resolveCompactionAnchorId(sessionId, 20_000)
    expect(anchor).toBeUndefined()
  })

  it('大量消息可找到压缩锚点', async () => {
    // 追加大量消息以超过 token 限制
    for (let i = 0; i < 50; i++) {
      await repo.appendMessages(sessionId, [
        createUserMessage(`用户消息 ${i}: ${'a'.repeat(100)}`),
        assistantMsg(`助手回复 ${i}: ${'b'.repeat(200)}`),
      ])
    }

    // keepRecentTokens 极小，强制需要压缩
    const anchor = await repo.resolveCompactionAnchorId(sessionId, 100)
    expect(anchor).toBeGreaterThan(0)
  })

  it('saveSummary 后上下文包含摘要', async () => {
    await seedLinearConversation()

    const rows = await repo.loadMessageRows(sessionId)
    const anchorId = rows[2]?.id ?? rows[0].id!

    await repo.saveSummary(sessionId, '用户询问了天气和菜谱', { anchorMessageId: anchorId })

    const ctx = await repo.loadContext(sessionId)
    // 摘要被注入为带 [Previous conversation summary] 前缀的 user 消息
    const summaryMsg = ctx.messages.find(m =>
      m.role === 'user' && Array.isArray(m.content) &&
      m.content.some((c: any) => c.text?.includes('Previous conversation summary'))
    )
    expect(summaryMsg).toBeDefined()
  })
})
