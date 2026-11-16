/**
 * 猜谜词库
 * - 字谜：riddle_demo CSV（构建为 char-riddles.json）
 * - 成语：npm `chinese-idiom-chengyu`（MIT）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { secureRandomInt } from '@zhin.js/game-kit';

export type RiddleType = 'char' | 'idiom';

export interface RiddleEntry {
  id: string;
  type: RiddleType;
  question: string;
  answer: string;
  aliases?: string[];
  hint?: string;
  explanation?: string;
}

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const charRiddles = JSON.parse(
  readFileSync(join(__dirname, 'data/char-riddles.json'), 'utf8'),
) as RiddleEntry[];

interface ChengyuLib {
  getDefinition: (word: string) => string;
}

const chengyu = require('chinese-idiom-chengyu') as ChengyuLib;
const { WORD_PINYIN_MAP } = require('chinese-idiom-chengyu/src/tools/parse.js') as {
  WORD_PINYIN_MAP: Map<string, string>;
};

const FOUR_CHAR = /^[\u4e00-\u9fff]{4}$/;

/**
 * Question-bank cleanup (#1250): sources repeat sentence punctuation (「……活下去。。」); one mark
 * is kept. Applied to every entry as it is loaded.
 */
export function cleanRiddleText(text: string): string {
  return text.trim().replace(/([。．！？，、；：…!?,;:])\1+/gu, '$1').replace(/[。．]([！？!?])/gu, '$1');
}

const charPool: RiddleEntry[] = (charRiddles as RiddleEntry[]).map((entry) => ({ ...entry, question: cleanRiddleText(entry.question) }));
const charById = new Map(charPool.map((r) => [r.id, r]));

let idiomPool: RiddleEntry[] | null = null;

function buildIdiomEntry(word: string): RiddleEntry | null {
  let gloss: string;
  try {
    gloss = chengyu.getDefinition(word).trim();
  } catch {
    return null;
  }
  if (!gloss || gloss.length < 4 || gloss === word) return null;
  return {
    id: `i:${word}`,
    type: 'idiom',
    question: `${cleanRiddleText(gloss).replace(/[。．.！!？?，,、；;：:\s]+$/u, '')}。（猜成语）`,
    answer: word,
    explanation: gloss,
  };
}

function buildIdiomPool(): RiddleEntry[] {
  if (idiomPool) return idiomPool;
  const pool: RiddleEntry[] = [];
  for (const word of WORD_PINYIN_MAP.keys()) {
    if (!FOUR_CHAR.test(word)) continue;
    const entry = buildIdiomEntry(word);
    if (entry) pool.push(entry);
  }
  idiomPool = pool;
  return pool;
}

export function riddlesByType(type: RiddleType): RiddleEntry[] {
  return type === 'char' ? charPool : buildIdiomPool();
}

export function getRiddleById(id: string): RiddleEntry | undefined {
  if (id.startsWith('c:')) return charById.get(id);
  if (id.startsWith('i:')) return buildIdiomEntry(id.slice(2)) ?? undefined;
  return undefined;
}

/**
 * A hint that tells the player something new (#1250): the first character of an idiom (the
 * question already says it has four), or for a one-character riddle four candidates that include
 * the answer. Decoys are drawn deterministically from other answers so a repeated hint agrees.
 */
export function riddleHint(entry: RiddleEntry): { readonly kind: 'first'; readonly char: string } | { readonly kind: 'choices'; readonly choices: readonly string[] } {
  if (entry.type === 'idiom') return { kind: 'first', char: [...entry.answer][0] ?? entry.answer };
  let seed = 0;
  for (const char of entry.id) seed = (seed * 31 + char.codePointAt(0)!) >>> 0;
  const decoys: string[] = [];
  for (let step = 0; decoys.length < 3 && step < 64; step++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const candidate = charPool[seed % charPool.length]?.answer;
    if (candidate && candidate !== entry.answer && !decoys.includes(candidate)) decoys.push(candidate);
  }
  const choices = [...decoys];
  choices.splice(seed % (decoys.length + 1), 0, entry.answer);
  return { kind: 'choices', choices };
}

export function riddleCount(): { char: number; idiom: number; total: number } {
  const char = charPool.length;
  const idiom = buildIdiomPool().length;
  return { char, idiom, total: char + idiom };
}

/** 每局随机抽题数量（避免把整库写入 session queue） */
export const QUESTIONS_PER_ROUND = 10;

export function pickRoundQueue(type: RiddleType, count = QUESTIONS_PER_ROUND): RiddleEntry[] {
  const pool = riddlesByType(type);
  const n = pool.length;
  const k = Math.min(count, n);
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + secureRandomInt(n - i);
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  return indices.slice(0, k).map((i) => pool[i]!);
}
