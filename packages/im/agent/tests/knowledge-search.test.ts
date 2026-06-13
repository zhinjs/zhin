import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKnowledgeSearchTool } from '../src/builtin/knowledge-search-tool.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'knowledge-test-'))
  // Create knowledge directory with test files
  const knowledgeDir = join(tempDir, 'knowledge')
  await mkdir(knowledgeDir, { recursive: true })

  await writeFile(join(knowledgeDir, 'cooking.md'), `# 菜谱

## 红烧肉

红烧肉是一道经典的中国家常菜。主要原料是五花肉，配合酱油、冰糖等调料慢炖而成。

做法步骤：
1. 五花肉切块，冷水下锅焯水
2. 锅中放油，加冰糖炒糖色
3. 放入五花肉翻炒上色
4. 加酱油、料酒、八角、桂皮
5. 加水没过肉，大火烧开转小火炖1小时

## 番茄炒蛋

番茄炒蛋是最简单的家常菜之一。
番茄和鸡蛋的搭配营养丰富。

做法：
1. 鸡蛋打散炒熟盛出
2. 番茄切块炒出汁
3. 倒入鸡蛋翻炒均匀
`)

  await writeFile(join(knowledgeDir, 'faq.md'), `# 常见问题

## 如何重置密码？

在登录页面点击"忘记密码"，输入注册邮箱，系统会发送重置链接。

## 如何联系我们？

发送邮件至 support@example.com 或拨打 400-123-4567。

## 退款政策

购买后 7 天内可申请全额退款。超过 7 天按比例退款。
`)

  // Create a subdirectory
  await mkdir(join(knowledgeDir, 'guides'), { recursive: true })
  await writeFile(join(knowledgeDir, 'guides', 'setup.md'), `# 安装指南

## 系统要求

- Node.js 20.19.0+
- pnpm 9.0+
- 操作系统：Windows / macOS / Linux

## 安装步骤

1. 克隆仓库
2. 运行 pnpm install
3. 配置 .env 文件
4. 运行 pnpm dev 启动开发服务器
`)
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe('knowledge_search tool', () => {
  it('should find content matching query', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '红烧肉' }) as string

    expect(result).toContain('红烧肉')
    expect(result).toContain('cooking.md')
    expect(result).toContain('找到')
  })

  it('should return multiple results sorted by relevance', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '番茄 鸡蛋' }) as string

    expect(result).toContain('番茄炒蛋')
    expect(result).toContain('cooking.md')
  })

  it('should search across subdirectories', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: 'Node.js pnpm' }) as string

    expect(result).toContain('setup.md')
    expect(result).toContain('guides')
  })

  it('should respect limit parameter', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '菜', limit: 1 }) as string

    expect(result).toContain('找到 1 条')
  })

  it('should handle no matches gracefully', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '量子力学 薛定谔方程' }) as string

    expect(result).toContain('未找到')
  })

  it('should handle missing knowledge directory', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'nonexistent') })
    const result = await tool.execute({ query: 'test' }) as string

    expect(result).toContain('不存在')
  })

  it('should handle empty query', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '' }) as string

    expect(result).toContain('请提供')
  })

  it('should find FAQ content', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '退款' }) as string

    expect(result).toContain('退款')
    expect(result).toContain('faq.md')
  })

  it('should handle multi-word queries', async () => {
    const tool = createKnowledgeSearchTool({ knowledgeDir: join(tempDir, 'knowledge') })
    const result = await tool.execute({ query: '密码 重置' }) as string

    expect(result).toContain('密码')
    expect(result).toContain('faq.md')
  })
})
