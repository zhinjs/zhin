/**
 * 复读刷屏检测（ADR 0039 §2 `flood`，切片 D）：本地判定，不调模型。
 *
 * - 只看**同一成员自己**的重复：同一成员在 `windowMs`（默认 60 秒）内发送规范化后相同或高度相似的消息
 *   达 `threshold`（默认 3）条即命中；多人各发一次同一句（跟复读）不算。
 * - 指纹：文本做 NFKC、小写、去空白与标点；@ 记为 `@<id>`；纯表情 / 图片等非文本段按内容摘要计
 *   （段类型 + 稳定序列化的 data）。回复引用段不计入（引用不同的同一句话仍算重复）。
 * - 高度相似：两条纯文本指纹都不短于 {@link MIN_SIMILAR_CHARS} 时，按字符二元组 Dice 系数 ≥ {@link SIMILARITY_THRESHOLD} 判定；
 *   更短的文本与含非文本段的消息只认完全相同。
 * - 命中后清空该成员的窗口：再命中需要重新攒满 `threshold` 条。
 * - 「判定后做什么」不在这里：调用方把命中交给规则执行器（没有生效的 `flood` 规则时执行器什么都不做）。
 * - 磁盘有界：不落盘。进程内按「群 + 成员」记最近的指纹，每个成员至多 {@link MAX_FLOOD_SAMPLES_PER_MEMBER} 条，
 *   总成员数至多 {@link MAX_FLOOD_TRACKED_MEMBERS}（超出按最久未发言淘汰），过窗即清。
 */
import { createHash } from 'node:crypto';

export const DEFAULT_FLOOD_WINDOW_MS = 60_000;
export const DEFAULT_FLOOD_THRESHOLD = 3;
export const MIN_FLOOD_THRESHOLD = 2;
export const MAX_FLOOD_THRESHOLD = 20;
/** 进程内最多跟踪的「群 + 成员」数。 */
export const MAX_FLOOD_TRACKED_MEMBERS = 5_000;
/** 每个成员最多保留的最近指纹条数。 */
export const MAX_FLOOD_SAMPLES_PER_MEMBER = 20;
/** 参与相似度判定的最短文本长度（规范化后）。 */
export const MIN_SIMILAR_CHARS = 6;
/** 字符二元组 Dice 系数阈值。 */
export const SIMILARITY_THRESHOLD = 0.8;
/** 参与相似度判定的最长文本（规范化后），更长的截断。 */
const MAX_SIMILARITY_CHARS = 500;
/** 证据原文摘录的单条上限。 */
const MAX_SAMPLE_TEXT_CHARS = 200;
/** 过期清理的最小间隔（观察时顺手做）。 */
const PRUNE_INTERVAL_MS = 60_000;

export interface FloodSegment {
  readonly type: string;
  readonly data?: unknown;
}

export interface FloodObservation {
  readonly platform: string;
  /** 平台原生群号。 */
  readonly groupId: string;
  readonly memberId: string;
  /** 纯文本视图（证据摘录与无段消息的指纹来源）。 */
  readonly content: string;
  readonly segments?: readonly FloodSegment[];
  /** 到达时间（毫秒）。 */
  readonly at: number;
}

export type FloodVerdict =
  | Readonly<{ hit: false }>
  | Readonly<{ hit: true; count: number; windowMs: number; samples: readonly string[] }>;

export interface FloodDetectorOptions {
  readonly windowMs?: number;
  readonly threshold?: number;
  readonly maxTrackedMembers?: number;
}

interface Sample {
  readonly at: number;
  readonly fingerprint: string;
  /** 纯文本指纹（含非文本段时为 `undefined`，只认完全相同）。 */
  readonly text?: string;
  readonly bigrams?: ReadonlyMap<string, number>;
  readonly excerpt: string;
}

const PUNCTUATION_OR_SPACE = /[\s\p{P}\p{S}]+/gu;

/** 规范化文本：NFKC、小写、去空白与标点 / 符号。 */
export function normalizeFloodText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(PUNCTUATION_OR_SPACE, '');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * 一条消息的指纹。`text` 只在消息全是文本 / @ 时给出（可做相似度）；空消息返回 `undefined`（不计）。
 */
export function floodFingerprint(content: string, segments?: readonly FloodSegment[]): { fingerprint: string; text?: string } | undefined {
  if (!segments?.length) {
    const text = normalizeFloodText(content);
    return text ? { fingerprint: `t:${text}`, text } : undefined;
  }
  const parts: string[] = [];
  let textOnly = true;
  for (const segment of segments) {
    const data = (segment.data ?? {}) as Record<string, unknown>;
    switch (segment.type) {
      case 'text': {
        const text = normalizeFloodText(typeof data.text === 'string' ? data.text : '');
        if (text) parts.push(text);
        break;
      }
      case 'mention': {
        const target = data.target ?? data.id ?? data.userId;
        parts.push(`@${String(target ?? '')}`);
        break;
      }
      case 'reply':
        break;
      default:
        textOnly = false;
        parts.push(`<${segment.type}:${digest(stableStringify(data))}>`);
    }
  }
  if (!parts.length) return undefined;
  const joined = parts.join('');
  return textOnly ? { fingerprint: `t:${joined}`, text: joined } : { fingerprint: `m:${digest(joined)}` };
}

function bigramsOf(text: string): Map<string, number> {
  const chars = [...text.slice(0, MAX_SIMILARITY_CHARS)];
  const result = new Map<string, number>();
  for (let index = 0; index < chars.length - 1; index += 1) {
    const gram = chars[index]! + chars[index + 1]!;
    result.set(gram, (result.get(gram) ?? 0) + 1);
  }
  return result;
}

/** 字符二元组 Dice 系数（0–1）。 */
export function floodSimilarity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let sizeA = 0;
  let sizeB = 0;
  let overlap = 0;
  for (const count of a.values()) sizeA += count;
  for (const [gram, count] of b) {
    sizeB += count;
    overlap += Math.min(count, a.get(gram) ?? 0);
  }
  return sizeA + sizeB === 0 ? 0 : (2 * overlap) / (sizeA + sizeB);
}

function similar(a: Sample, b: Sample): boolean {
  if (a.fingerprint === b.fingerprint) return true;
  if (!a.bigrams || !b.bigrams) return false;
  return floodSimilarity(a.bigrams, b.bigrams) >= SIMILARITY_THRESHOLD;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export class GroupFloodDetector {
  readonly windowMs: number;
  readonly threshold: number;
  readonly #maxTracked: number;
  /** `<platform>\0<群号>\0<成员>` → 最近的指纹（按时间升序）；Map 顺序 = 最近活跃顺序。 */
  readonly #members = new Map<string, Sample[]>();
  #lastPruneAt = 0;

  constructor(options: FloodDetectorOptions = {}) {
    this.windowMs = clampInt(options.windowMs, DEFAULT_FLOOD_WINDOW_MS, 1_000, 10 * 60_000);
    this.threshold = clampInt(options.threshold, DEFAULT_FLOOD_THRESHOLD, MIN_FLOOD_THRESHOLD, MAX_FLOOD_THRESHOLD);
    this.#maxTracked = clampInt(options.maxTrackedMembers, MAX_FLOOD_TRACKED_MEMBERS, 1, MAX_FLOOD_TRACKED_MEMBERS);
  }

  /** 进程内跟踪的成员数（测试与观测）。 */
  get trackedSize(): number {
    return this.#members.size;
  }

  /** 记一条群消息；达到阈值时返回命中（并清空该成员窗口）。 */
  observe(input: FloodObservation): FloodVerdict {
    if (!input.platform || !input.groupId || !input.memberId) return { hit: false };
    const print = floodFingerprint(input.content, input.segments);
    if (!print) return { hit: false };
    this.#prune(input.at);
    const key = `${input.platform}\u0000${input.groupId}\u0000${input.memberId}`;
    const since = input.at - this.windowMs;
    const recent = (this.#members.get(key) ?? []).filter((sample) => sample.at > since);
    const current: Sample = {
      at: input.at,
      fingerprint: print.fingerprint,
      ...(print.text !== undefined && [...print.text].length >= MIN_SIMILAR_CHARS
        ? { text: print.text, bigrams: bigramsOf(print.text) }
        : {}),
      excerpt: (input.content.trim() || print.fingerprint).slice(0, MAX_SAMPLE_TEXT_CHARS),
    };
    const matches = recent.filter((sample) => similar(sample, current));
    this.#members.delete(key);
    if (matches.length + 1 >= this.threshold) {
      return {
        hit: true,
        count: matches.length + 1,
        windowMs: this.windowMs,
        samples: Object.freeze([...matches, current].slice(-this.threshold).map((sample) => sample.excerpt)),
      };
    }
    recent.push(current);
    this.#members.set(key, recent.slice(-MAX_FLOOD_SAMPLES_PER_MEMBER));
    while (this.#members.size > this.#maxTracked) {
      const oldest = this.#members.keys().next().value;
      if (oldest === undefined) break;
      this.#members.delete(oldest);
    }
    return { hit: false };
  }

  clear(): void {
    this.#members.clear();
  }

  #prune(now: number): void {
    if (now - this.#lastPruneAt < PRUNE_INTERVAL_MS) return;
    this.#lastPruneAt = now;
    const since = now - this.windowMs;
    for (const [key, samples] of this.#members) {
      const last = samples[samples.length - 1];
      if (!last || last.at <= since) this.#members.delete(key);
    }
  }
}
