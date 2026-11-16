import type { FixtureTextProvider } from '../../../ai/tests/helpers/text-provider-fixture.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolExecutionContext } from '@zhin.js/tool'

import {
  contentBigrams,
  createNativeKnowledgeToolFeature,
  MarkdownKnowledgeIndex,
  markdownHeadings,
} from '../../src/plugin-runtime/native-knowledge-tool.js'
import { createNativeAgentToolSuite } from '../../src/plugin-runtime/native-tool-suite.js'

let tempDir: string

const context = Object.freeze({ signal: new AbortController().signal }) as ToolExecutionContext

function createTool(directory = 'knowledge') {
  return createNativeKnowledgeToolFeature(
    new MarkdownKnowledgeIndex(join(tempDir, directory), { cacheTtlMs: 0 }),
  ).definition
}

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

describe('native knowledge_search Tool Feature', () => {
  it('is published by the canonical native suite only when an index is configured', () => {
    const resolver = (): never => { throw new Error('No image operation in this test') }
    const withoutKnowledge = createNativeAgentToolSuite({ resolveInference: resolver })
    const index = new MarkdownKnowledgeIndex(join(tempDir, 'knowledge'))
    const withKnowledge = createNativeAgentToolSuite({ resolveInference: resolver, knowledgeIndex: index })

    expect(withoutKnowledge.map((tool) => tool.name)).not.toContain('knowledge_search')
    expect(withKnowledge.map((tool) => tool.name).filter((name) => name === 'knowledge_search'))
      .toEqual(['knowledge_search'])
  })

  it('should find content matching query', async () => {
    const result = await createTool().execute({ query: '红烧肉' }, context)

    expect(result).toContain('红烧肉')
    expect(result).toContain('cooking.md')
    expect(result).toContain('找到')
  })

  it('should return multiple results sorted by relevance', async () => {
    const result = await createTool().execute({ query: '番茄 鸡蛋' }, context)

    expect(result).toContain('番茄炒蛋')
    expect(result).toContain('cooking.md')
  })

  it('should search across subdirectories', async () => {
    const result = await createTool().execute({ query: 'Node.js pnpm' }, context)

    expect(result).toContain('setup.md')
    expect(result).toContain('guides')
  })

  it('should respect limit parameter', async () => {
    const result = await createTool().execute({ query: '菜', limit: 1 }, context)

    expect(result).toContain('找到 1 条')
  })

  it('should handle no matches gracefully', async () => {
    const result = await createTool().execute({ query: '量子力学 薛定谔方程' }, context)

    expect(result).toContain('未找到')
  })

  it('should handle missing knowledge directory', async () => {
    const result = await createTool('nonexistent').execute({ query: 'test' }, context)

    expect(result).toContain('does not exist')
  })

  it('should handle empty query', async () => {
    await expect(createTool().execute({ query: '' }, context))
      .rejects.toThrow('query must be a non-empty string')
  })

  it('should find FAQ content', async () => {
    const result = await createTool().execute({ query: '退款' }, context)

    expect(result).toContain('退款')
    expect(result).toContain('faq.md')
  })

  it('should handle multi-word queries', async () => {
    const result = await createTool().execute({ query: '密码 重置' }, context)

    expect(result).toContain('密码')
    expect(result).toContain('faq.md')
  })
})

describe('knowledge base outline and discovery (#1250 b27)', () => {
  it('lists files with level-1/2 headings, skipping front matter and fenced code', async () => {
    await writeFile(join(tempDir, 'knowledge', 'notes.md'), [
      '---', 'title: "# not a heading"', '---',
      '# 使用说明', '', '```md', '# fenced heading', '```', '', '## 添加新知识', '', '### deeper', 'text', '## 部署 ##',
    ].join('\n'))
    const index = new MarkdownKnowledgeIndex(join(tempDir, 'knowledge'), { cacheTtlMs: 60_000 })
    const outline = await index.outline(context.signal)
    expect(outline.status).toBe('ready')
    expect(outline.files.map((file) => file.source)).toEqual(['cooking.md', 'faq.md', 'guides/setup.md', 'notes.md'])
    expect(outline.files.find((file) => file.source === 'notes.md')?.headings).toEqual([
      { level: 1, text: '使用说明' },
      { level: 2, text: '添加新知识' },
      { level: 2, text: '部署' },
    ])
  })

  it('closes a fence only on a fence line followed by whitespace (CommonMark)', async () => {
    await writeFile(join(tempDir, 'knowledge', 'code.md'), [
      '# 代码示例', '', '```md', '```js', '# still inside the fence', '```   ', '', '## 之后的标题',
      '', '~~~~', '~~~', '## 仍在围栏里', '~~~~', '## 最后',
    ].join('\n'))
    const outline = await new MarkdownKnowledgeIndex(join(tempDir, 'knowledge')).outline(context.signal)
    expect(outline.files.find((file) => file.source === 'code.md')?.headings).toEqual([
      { level: 1, text: '代码示例' },
      { level: 2, text: '之后的标题' },
      { level: 2, text: '最后' },
    ])
  })

  it('shares the search cache and re-reads the directory after invalidate()', async () => {
    const index = new MarkdownKnowledgeIndex(join(tempDir, 'knowledge'), { cacheTtlMs: 60_000 })
    const before = await index.outline(context.signal)
    await writeFile(join(tempDir, 'knowledge', 'new.md'), '# 新文档\n')
    expect((await index.outline(context.signal)).files).toBe(before.files)
    index.invalidate()
    expect((await index.outline(context.signal)).files.map((file) => file.source)).toContain('new.md')
  })

  it('reports a missing or empty knowledge directory', async () => {
    expect((await new MarkdownKnowledgeIndex(join(tempDir, 'nope')).outline(context.signal)).status).toBe('missing')
    await mkdir(join(tempDir, 'empty'))
    expect((await new MarkdownKnowledgeIndex(join(tempDir, 'empty')).outline(context.signal)).status).toBe('empty')
  })

  it('matches an unspaced Chinese question by its character bigrams', async () => {
    await writeFile(join(tempDir, 'knowledge', 'bot.md'), '# 机器人\n\n## 如何添加新知识\n\n把 Markdown 文件放进 knowledge 目录即可。\n')
    const result = await createTool().execute({ query: '怎么给这个机器人添加新知识' }, context)
    expect(result).toContain('bot.md')
    expect(result).toContain('添加新知识')
    // Unrelated CJK queries still find nothing.
    expect(await createTool().execute({ query: '量子力学 薛定谔方程' }, context)).toContain('未找到')
  })

  it('ignores function-word bigrams: no false hits, and long questions are scored on their topic', async () => {
    await writeFile(join(tempDir, 'knowledge', 'deploy.md'), '# 部署指南\n\n用 Docker 部署机器人到服务器。\n')
    await writeFile(join(tempDir, 'knowledge', 'filler.md'), '# 杂谈\n\n怎么可以知道这个一下我想一个什么如何\n')
    const offTopic = await createTool().execute({ query: '量子力学怎么可以知道' }, context)
    expect(offTopic).toContain('未找到')
    const deploy = await createTool().execute({ query: '我想知道怎么可以把这个机器人部署一下' }, context)
    expect(deploy).toContain('deploy.md')
    expect(deploy).not.toContain('filler.md')
    expect([...contentBigrams('我想知道怎么可以把这个机器人部署一下')]).toEqual(['机器', '器人', '人部', '部署'])
  })

  it('tells the model to search it first for questions about the bot or project', () => {
    const definition = createTool()
    expect(definition.description).toContain('knowledge base')
    expect(definition.description).toContain('Use it first for questions about this bot or this project')
  })
})

describe('markdownHeadings parsing (CodeQL polynomial-redos)', () => {
  it('parses ATX headings like the previous pattern', () => {
    const text = [
      '# 标题', '##  两个空格 ', '## 部署 ##', '## 尾部#号#', '#\t制表符\t', '   # 缩进三格', '    # 缩进四格也算（\\s{0,3} 之后）',
      '#不是标题', '### 三级', '# #', '##', '#  ', '## a ## b', '## x #  ',
    ].join('\n');
    expect(markdownHeadings(text).map((heading) => `${heading.level}:${heading.text}`)).toEqual([
      '1:标题', '2:两个空格', '2:部署', '2:尾部#号#', '1:制表符', '1:缩进三格', '1:#', '2:a ## b', '2:x',
    ]);
  });

  it('stays linear on lines of repeated tabs', () => {
    const line = `# a${'\t\t'.repeat(50_000)}b${'\t\t'.repeat(50_000)}`;
    const started = performance.now();
    markdownHeadings(`${line}\n${'#\t'.repeat(50_000)}`);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

