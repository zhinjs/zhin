import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
  type ToolInputJsonObjectSchema,
  type ToolInputJsonSchema,
} from '@zhin.js/tool';

export interface KnowledgeMatch {
  readonly source: string;
  readonly chunk: number;
  readonly score: number;
  readonly text: string;
}

export interface KnowledgeSearchResult {
  readonly status: 'ready' | 'missing' | 'empty';
  readonly indexedChunks: number;
  readonly matches: readonly KnowledgeMatch[];
}

export interface KnowledgeIndex {
  search(query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearchResult>;
}

interface KnowledgeChunk {
  readonly source: string;
  readonly chunk: number;
  readonly text: string;
}

export interface MarkdownKnowledgeIndexOptions {
  readonly cacheTtlMs?: number;
  readonly maxDepth?: number;
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
}

/** Encapsulated project-document index. It never reads outside its configured root. */
export class MarkdownKnowledgeIndex implements KnowledgeIndex {
  readonly #root: string;
  readonly #cacheTtlMs: number;
  readonly #maxDepth: number;
  readonly #maxFiles: number;
  readonly #maxFileBytes: number;
  #cache: Readonly<{ loadedAt: number; chunks: readonly KnowledgeChunk[] }> | undefined;

  constructor(root: string, options: MarkdownKnowledgeIndexOptions = {}) {
    if (!root.trim()) throw new TypeError('Knowledge root cannot be empty');
    this.#root = resolve(root);
    this.#cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.#maxDepth = options.maxDepth ?? 5;
    this.#maxFiles = options.maxFiles ?? 1_000;
    this.#maxFileBytes = options.maxFileBytes ?? 1_048_576;
  }

  async search(query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearchResult> {
    signal.throwIfAborted();
    if (!await this.#isDirectory()) return frozenResult('missing', 0, []);
    const chunks = await this.#loadChunks(signal);
    if (chunks.length === 0) return frozenResult('empty', 0, []);
    const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
    const matches = chunks
      .map((chunk) => ({ ...chunk, score: scoreChunk(chunk.text, terms) }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score
        || left.source.localeCompare(right.source)
        || left.chunk - right.chunk)
      .slice(0, limit)
      .map((chunk) => Object.freeze(chunk));
    return frozenResult('ready', chunks.length, matches);
  }

  async #isDirectory(): Promise<boolean> {
    try {
      return (await stat(this.#root)).isDirectory();
    } catch {
      return false;
    }
  }

  async #loadChunks(signal: AbortSignal): Promise<readonly KnowledgeChunk[]> {
    const now = Date.now();
    if (this.#cache && now - this.#cache.loadedAt < this.#cacheTtlMs) return this.#cache.chunks;
    const files = await collectKnowledgeFiles(this.#root, this.#maxDepth, this.#maxFiles, signal);
    const chunks: KnowledgeChunk[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      try {
        const metadata = await stat(file);
        if (!metadata.isFile() || metadata.size > this.#maxFileBytes) continue;
        const text = await readFile(file, { encoding: 'utf8', signal });
        for (const [chunk, content] of chunkText(text).entries()) {
          chunks.push(Object.freeze({ source: relative(this.#root, file), chunk, text: content }));
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    const value = Object.freeze([...chunks]);
    this.#cache = Object.freeze({ loadedAt: now, chunks: value });
    return value;
  }
}

export interface NativeKnowledgeToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: 'knowledge_search';
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export function createNativeKnowledgeToolFeature(index: KnowledgeIndex): NativeKnowledgeToolFeature {
  return Object.freeze({
    feature: toolFeatureId,
    name: 'knowledge_search',
    definition: defineAgentTool<Record<string, unknown>, string>({
      description: 'Search explicitly configured project Markdown and text documentation.',
      inputSchema: objectSchema({
        query: { type: 'string', description: 'Search keywords or phrase' },
        limit: { type: 'number', minimum: 1, maximum: 20 },
      }, ['query']),
      approval: 'never',
      tags: Object.freeze(['knowledge', 'file']),
      keywords: Object.freeze(['knowledge', 'search', '知识', '检索', '文档', 'FAQ']),
      execute: (input, context) => searchKnowledge(index, input, context),
    }),
  });
}

async function searchKnowledge(
  index: KnowledgeIndex,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const query = requiredString(input.query, 'query');
  return formatKnowledgeResult(
    query,
    await index.search(query, boundedLimit(input.limit), context.signal),
  );
}

async function collectKnowledgeFiles(
  directory: string,
  depth: number,
  limit: number,
  signal: AbortSignal,
): Promise<string[]> {
  if (depth <= 0 || limit <= 0) return [];
  signal.throwIfAborted();
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    signal.throwIfAborted();
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const target = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectKnowledgeFiles(target, depth - 1, limit - files.length, signal));
    } else if (entry.isFile() && /\.(?:md|markdown|txt)$/iu.test(entry.name)) {
      files.push(target);
    }
    if (files.length >= limit) break;
  }
  return files;
}

function chunkText(text: string, maxChunkSize = 1_000): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean)) {
    if (paragraph.length <= maxChunkSize) {
      chunks.push(paragraph);
      continue;
    }
    for (let offset = 0; offset < paragraph.length; offset += maxChunkSize) {
      chunks.push(paragraph.slice(offset, offset + maxChunkSize));
    }
  }
  return chunks;
}

function scoreChunk(text: string, terms: readonly string[]): number {
  const normalized = text.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function formatKnowledgeResult(query: string, result: KnowledgeSearchResult): string {
  if (result.status === 'missing') return 'Configured knowledge directory does not exist.';
  if (result.status === 'empty') return 'Configured knowledge directory contains no readable Markdown or text documents.';
  if (result.matches.length === 0) {
    return `未找到与 "${query}" 相关的知识库内容（共索引 ${result.indexedChunks} 个段落）。`;
  }
  const rows = result.matches.map((match, index) => {
    const snippet = match.text.length > 300 ? `${match.text.slice(0, 300)}...` : match.text;
    return `### ${index + 1}. [${match.source}] (匹配度: ${match.score})\n${snippet}`;
  });
  return `找到 ${result.matches.length} 条相关结果（共索引 ${result.indexedChunks} 个段落）：\n\n${rows.join('\n\n')}`;
}

function frozenResult(
  status: KnowledgeSearchResult['status'],
  indexedChunks: number,
  matches: readonly KnowledgeMatch[],
): KnowledgeSearchResult {
  return Object.freeze({ status, indexedChunks, matches: Object.freeze([...matches]) });
}

function boundedLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(20, Math.floor(value)))
    : 5;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function objectSchema(
  properties: Record<string, ToolInputJsonSchema>,
  required: readonly string[],
): ToolInputJsonObjectSchema {
  return Object.freeze({ type: 'object', properties: Object.freeze(properties), required: Object.freeze([...required]) });
}
