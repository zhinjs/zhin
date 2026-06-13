/**
 * knowledge_search — 本地知识库全文检索（v0：段落分块 + 关键词匹配）。
 *
 * 从配置的 `ai.knowledge.baseDir`（默认 `cwd/knowledge/`）读取 Markdown 文件，
 * 按段落分块后用关键词匹配搜索，返回匹配片段及来源路径。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { Message, ToolParametersSchema, ToolResult } from '@zhin.js/core';
import { BuiltinBaseTool } from './builtin-base-tool.js';

/** 单个知识块 */
interface KnowledgeChunk {
  /** 源文件绝对路径 */
  filePath: string;
  /** 相对于 baseDir 的路径 */
  relPath: string;
  /** 块在文件中的序号（从 0 开始） */
  chunkIndex: number;
  /** 块文本内容 */
  text: string;
}

const PARAMS: ToolParametersSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '搜索关键词或短语（支持多词空格分隔）' },
    limit: { type: 'number', description: '最多返回条数（默认 5）' },
  },
  required: ['query'],
};

/**
 * 递归扫描目录，收集所有 .md / .txt 文件路径。
 */
async function collectFiles(dir: string, maxDepth = 5): Promise<string[]> {
  if (maxDepth <= 0) return [];
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectFiles(fullPath, maxDepth - 1));
    } else if (entry.isFile() && /\.(md|txt|markdown)$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 将文件内容按段落分块（双换行符分隔）。
 * 每块上限 1000 字符，超过则按单换行符再拆。
 */
function chunkText(text: string, maxChunkSize = 1000): string[] {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChunkSize) {
      chunks.push(para);
    } else {
      // 按单换行拆分大段落
      const lines = para.split('\n');
      let current = '';
      for (const line of lines) {
        if (current && (current.length + line.length + 1) > maxChunkSize) {
          chunks.push(current);
          current = line;
        } else {
          current = current ? `${current}\n${line}` : line;
        }
      }
      if (current) chunks.push(current);
    }
  }
  return chunks;
}

/**
 * 关键词匹配评分：返回 query 中命中的关键词数量。
 * 支持多词空格分隔，每个词独立匹配。
 */
function scoreChunk(text: string, query: string): number {
  const lower = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score++;
  }
  return score;
}

class KnowledgeSearchTool extends BuiltinBaseTool {
  readonly name = 'knowledge_search';
  readonly description = '在本地知识库中检索相关信息。知识库由 Markdown 文件组成，放在项目 knowledge/ 目录下。返回匹配片段和来源文件路径。适用于查找说明书、规章、菜谱、FAQ 等本地文档。';
  readonly parameters = PARAMS;
  readonly kind = 'knowledge';
  readonly keywords = ['knowledge', 'search', '知识', '检索', '文档', 'FAQ', '说明'];

  private knowledgeDir: string;
  /** 缓存：加载时间戳 */
  private cacheTime = 0;
  /** 缓存：分块数据 */
  private cachedChunks: KnowledgeChunk[] = [];
  /** 缓存 TTL（毫秒） */
  private cacheTtl = 60_000;

  constructor(knowledgeDir: string) {
    super();
    this.knowledgeDir = resolve(knowledgeDir);
  }

  /**
   * 加载并分块索引知识库文件。
   * 带 60 秒缓存避免重复 IO。
   */
  private async loadChunks(): Promise<KnowledgeChunk[]> {
    const now = Date.now();
    if (this.cachedChunks.length > 0 && (now - this.cacheTime) < this.cacheTtl) {
      return this.cachedChunks;
    }

    const files = await collectFiles(this.knowledgeDir);
    const chunks: KnowledgeChunk[] = [];

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const relPath = relative(this.knowledgeDir, filePath);
        const textChunks = chunkText(content);
        for (let i = 0; i < textChunks.length; i++) {
          chunks.push({
            filePath,
            relPath,
            chunkIndex: i,
            text: textChunks[i],
          });
        }
      } catch {
        // 跳过不可读文件
      }
    }

    this.cachedChunks = chunks;
    this.cacheTime = now;
    return chunks;
  }

  async run(args: Record<string, unknown>, _commMessage?: Message): Promise<ToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) return '请提供搜索关键词（query）。';

    const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 5;

    // 检查知识库目录是否存在
    try {
      const s = await stat(this.knowledgeDir);
      if (!s.isDirectory()) return `知识库路径不是目录: ${this.knowledgeDir}`;
    } catch {
      return `知识库目录不存在: ${this.knowledgeDir}\n请创建该目录并放入 .md 文件，或在 zhin.config.yml 中配置 ai.knowledge.baseDir。`;
    }

    const chunks = await this.loadChunks();
    if (!chunks.length) return `知识库目录为空: ${this.knowledgeDir}\n请放入 .md / .txt 文件。`;

    // 评分并排序
    const scored = chunks
      .map(chunk => ({ ...chunk, score: scoreChunk(chunk.text, query) }))
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (!scored.length) return `未找到与 "${query}" 相关的知识库内容（共索引 ${chunks.length} 个段落）。`;

    const lines = scored.map((c, i) => {
      const snippet = c.text.length > 300 ? c.text.slice(0, 300) + '...' : c.text;
      return `### ${i + 1}. [${c.relPath}] (匹配度: ${c.score})\n${snippet}`;
    });

    return `找到 ${scored.length} 条相关结果（共索引 ${chunks.length} 个段落）：\n\n${lines.join('\n\n')}`;
  }
}

export interface KnowledgeSearchOptions {
  /** 知识库目录绝对路径 */
  knowledgeDir: string;
}

export function createKnowledgeSearchTool(options: KnowledgeSearchOptions) {
  return new KnowledgeSearchTool(options.knowledgeDir).toTool();
}
