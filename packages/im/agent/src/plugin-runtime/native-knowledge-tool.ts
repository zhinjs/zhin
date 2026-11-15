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
import { rerankDecisionMatches, resolveSearchDecision, type NativeSearchDecisionResolver } from '../decision/retrieval.js';

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

/** One indexed document as the prompt's knowledge index lists it: path and level-1/2 headings (#1250 b27). */
export interface KnowledgeOutlineFile {
  /** Path relative to the knowledge root, `/`-separated. */
  readonly source: string;
  readonly headings: readonly Readonly<{ level: 1 | 2; text: string }>[];
}

export interface KnowledgeOutline {
  readonly status: KnowledgeSearchResult['status'];
  readonly files: readonly KnowledgeOutlineFile[];
}

export interface KnowledgeIndex {
  search(query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearchResult>;
  /**
   * Document paths and level-1/2 headings for the system prompt's knowledge index (#1250 b27).
   * Shares the search cache: the same TTL and {@link invalidate} apply.
   */
  outline?(signal: AbortSignal): Promise<KnowledgeOutline>;
  /** Drops cached documents so the next search reads the directory again (#1250 file watching). */
  invalidate?(): void;
}

interface KnowledgeChunk {
  readonly source: string;
  readonly chunk: number;
  readonly text: string;
}

interface KnowledgeCache {
  readonly loadedAt: number;
  readonly chunks: readonly KnowledgeChunk[];
  readonly outline: readonly KnowledgeOutlineFile[];
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
  #cache: KnowledgeCache | undefined;

  constructor(root: string, options: MarkdownKnowledgeIndexOptions = {}) {
    if (!root.trim()) throw new TypeError('Knowledge root cannot be empty');
    this.#root = resolve(root);
    this.#cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.#maxDepth = options.maxDepth ?? 5;
    this.#maxFiles = options.maxFiles ?? 1_000;
    this.#maxFileBytes = options.maxFileBytes ?? 1_048_576;
  }

  /** The indexed directory (absolute). */
  get root(): string { return this.#root; }

  invalidate(): void {
    this.#cache = undefined;
  }

  async search(query: string, limit: number, signal: AbortSignal): Promise<KnowledgeSearchResult> {
    signal.throwIfAborted();
    if (!await this.#isDirectory()) return frozenResult('missing', 0, []);
    const { chunks } = await this.#load(signal);
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

  async outline(signal: AbortSignal): Promise<KnowledgeOutline> {
    signal.throwIfAborted();
    if (!await this.#isDirectory()) return Object.freeze({ status: 'missing', files: Object.freeze([]) });
    const { outline } = await this.#load(signal);
    return Object.freeze({ status: outline.length ? 'ready' : 'empty', files: outline });
  }

  async #isDirectory(): Promise<boolean> {
    try {
      return (await stat(this.#root)).isDirectory();
    } catch {
      return false;
    }
  }

  async #load(signal: AbortSignal): Promise<KnowledgeCache> {
    const now = Date.now();
    if (this.#cache && now - this.#cache.loadedAt < this.#cacheTtlMs) return this.#cache;
    const files = await collectKnowledgeFiles(this.#root, this.#maxDepth, this.#maxFiles, signal);
    const chunks: KnowledgeChunk[] = [];
    const outline: KnowledgeOutlineFile[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      try {
        const metadata = await stat(file);
        if (!metadata.isFile() || metadata.size > this.#maxFileBytes) continue;
        const text = await readFile(file, { encoding: 'utf8', signal });
        const source = relative(this.#root, file);
        for (const [chunk, content] of chunkText(text).entries()) {
          chunks.push(Object.freeze({ source, chunk, text: content }));
        }
        outline.push(Object.freeze({ source: source.split('\\').join('/'), headings: markdownHeadings(text) }));
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    const cache: KnowledgeCache = Object.freeze({
      loadedAt: now,
      chunks: Object.freeze([...chunks]),
      outline: Object.freeze([...outline]),
    });
    this.#cache = cache;
    return cache;
  }
}

/** Model-facing description of `knowledge_search` (#1250 b27). */
export const KNOWLEDGE_SEARCH_DESCRIPTION = 'Search this project\'s knowledge base: the Markdown and text documents in the '
  + 'configured knowledge directory (FAQs, guides, how-tos about this bot and this project). Use it first for '
  + 'questions about this bot or this project (what it can do, how to use, configure or extend it) before '
  + 'answering from general knowledge; the system prompt lists the indexed files and headings. Returns the best '
  + 'matching passages with their file names; cite the file, and say so when nothing matches.';

export interface NativeKnowledgeToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: 'knowledge_search';
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export function createNativeKnowledgeToolFeature(
  index: KnowledgeIndex,
  resolveDecision?: NativeSearchDecisionResolver,
): NativeKnowledgeToolFeature {
  return Object.freeze({
    feature: toolFeatureId,
    name: 'knowledge_search',
    definition: defineAgentTool<Record<string, unknown>, string>({
      description: KNOWLEDGE_SEARCH_DESCRIPTION,
      inputSchema: objectSchema({
        query: {
          type: 'string',
          description: 'A few distinctive keywords from the question or the index headings, separated by spaces, e.g. "添加 知识" or "deploy docker"',
        },
        limit: { type: 'number', minimum: 1, maximum: 20 },
      }, ['query']),
      requiresApproval: 'never',
      readOnly: true,
      tags: Object.freeze(['knowledge', 'file']),
      keywords: Object.freeze(['knowledge', 'search', '知识', '检索', '文档', 'FAQ']),
      execute: (input, context) => searchKnowledge(index, input, context, resolveDecision),
    }),
  });
}

async function searchKnowledge(
  index: KnowledgeIndex,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  resolveDecision?: NativeSearchDecisionResolver,
): Promise<string> {
  const query = requiredString(input.query, 'query');
  const limit = boundedLimit(input.limit);
  const decision = resolveSearchDecision(resolveDecision, context);
  const result = await index.search(query, decision ? 20 : limit, context.signal);
  const matches = await rerankDecisionMatches(decision, query, result.matches, match => match.text, limit, context.signal);
  return formatKnowledgeResult(query, frozenResult(result.status, result.indexedChunks, matches));
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

/** Level-1/2 ATX headings outside front matter and fenced code, in document order (raw text). */
export function markdownHeadings(text: string): readonly Readonly<{ level: 1 | 2; text: string }>[] {
  const headings: Readonly<{ level: 1 | 2; text: string }>[] = [];
  const lines = text.split(/\r?\n/u);
  let index = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, position) => position > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end > 0) index = end + 1;
  }
  let fence: string | undefined;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!;
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^\s{0,3}(#{1,2})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/u);
    if (heading) headings.push(Object.freeze({ level: heading[1]!.length as 1 | 2, text: heading[2]! }));
  }
  return Object.freeze(headings);
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

/** Share of a CJK term's character bigrams a chunk must contain to count as a partial match. */
const CJK_PARTIAL_MATCH_MIN = 0.3;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/gu;

function scoreChunk(text: string, terms: readonly string[]): number {
  const normalized = text.toLowerCase();
  const score = terms.reduce((total, term) => total + (normalized.includes(term) ? 1 : partialCjkMatch(normalized, term)), 0);
  return Math.round(score * 100) / 100;
}

/**
 * CJK questions arrive without spaces ("怎么给这个机器人添加新知识"), so a whole-term match rarely
 * hits. Such a term scores the share of its character bigrams found in the chunk (#1250 b27).
 */
function partialCjkMatch(normalized: string, term: string): number {
  const bigrams = new Set<string>();
  for (const run of term.match(CJK_RUN) ?? []) {
    const chars = [...run];
    for (let index = 0; index + 1 < chars.length; index += 1) bigrams.add(chars[index]! + chars[index + 1]!);
  }
  if (bigrams.size < 2) return 0;
  let hits = 0;
  for (const bigram of bigrams) if (normalized.includes(bigram)) hits += 1;
  const share = hits / bigrams.size;
  return share >= CJK_PARTIAL_MATCH_MIN ? share : 0;
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
