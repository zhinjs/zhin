/**
 * BM25 ranking for semantic memory (#734).
 *
 * The roadmap picks BM25 for the first retrieval version; embeddings come only
 * if evals show it is not enough. Documents are an entry's key, content and
 * tags. Tokenization is language-neutral and dependency-free:
 * - Latin / digits: lower-cased words (split on non-alphanumerics, `_`, `:`).
 * - CJK: overlapping character bigrams plus single characters, so "喝茶" and
 *   "茶" both match "喜欢喝茶" without a segmenter.
 */
import { parseMemoryTags, type MemoryEntryRecord } from './memory-entry-models.js';

export interface Bm25Options {
  /** Term-frequency saturation. */
  readonly k1?: number;
  /** Length normalization. */
  readonly b?: number;
}

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const SEGMENT = /[\p{L}\p{N}]+/gu;

/** Splits text into BM25 terms. */
export function tokenizeForBm25(text: string): string[] {
  const terms: string[] = [];
  for (const match of text.toLowerCase().matchAll(SEGMENT)) {
    const segment = match[0];
    let latin = '';
    let cjkRun = '';
    const flushLatin = () => {
      if (latin) terms.push(latin);
      latin = '';
    };
    const flushCjk = () => {
      const chars = [...cjkRun];
      for (let index = 0; index < chars.length; index += 1) {
        terms.push(chars[index]!);
        if (index + 1 < chars.length) terms.push(chars[index]! + chars[index + 1]!);
      }
      cjkRun = '';
    };
    for (const char of segment) {
      if (CJK.test(char)) {
        flushLatin();
        cjkRun += char;
      } else {
        flushCjk();
        latin += char;
      }
    }
    flushLatin();
    flushCjk();
  }
  return terms;
}

export function memoryEntryDocument(record: MemoryEntryRecord): string {
  return `${record.key} ${record.content} ${parseMemoryTags(record.tags).join(' ')}`;
}

export interface Bm25Hit<T> {
  readonly item: T;
  readonly score: number;
}

/**
 * Scores `items` against `query` with BM25 over the given corpus and returns
 * the positive-scoring ones, best first. Ties keep input order.
 */
export function rankBm25<T>(
  items: readonly T[],
  query: string,
  toDocument: (item: T) => string,
  options: Bm25Options = {},
): Bm25Hit<T>[] {
  const queryTerms = [...new Set(tokenizeForBm25(query))];
  if (queryTerms.length === 0 || items.length === 0) return [];
  const k1 = options.k1 ?? DEFAULT_K1;
  const b = options.b ?? DEFAULT_B;

  const docs = items.map((item) => {
    const terms = tokenizeForBm25(toDocument(item));
    const frequencies = new Map<string, number>();
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    return { item, length: terms.length, frequencies };
  });
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / docs.length || 1;
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, docs.filter((doc) => doc.frequencies.has(term)).length);
  }

  const hits: Bm25Hit<T>[] = [];
  for (const doc of docs) {
    let score = 0;
    for (const term of queryTerms) {
      const tf = doc.frequencies.get(term);
      if (!tf) continue;
      const df = documentFrequency.get(term) ?? 0;
      // BM25+ style idf floor keeps terms present in every document positive.
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / averageLength))));
    }
    if (score > 0) hits.push({ item: doc.item, score });
  }
  return hits.sort((left, right) => right.score - left.score);
}

/** BM25 over memory entries (key + content + tags); newer entries win ties. */
export function rankMemoryEntries(
  records: readonly MemoryEntryRecord[],
  query: string,
  options?: Bm25Options,
): Bm25Hit<MemoryEntryRecord>[] {
  const byRecency = [...records].sort((left, right) => right.updated_at - left.updated_at);
  return rankBm25(byRecency, query, memoryEntryDocument, options);
}
