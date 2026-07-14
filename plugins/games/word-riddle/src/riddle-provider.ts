/**
 * 猜谜词库
 * - 字谜：riddle_demo CSV（构建为 char-riddles.json）
 * - 成语：npm `chinese-idiom-chengyu`（MIT）
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { secureRandomInt } from '@zhin.js/game-shared';

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

const charPool: RiddleEntry[] = charRiddles as RiddleEntry[];
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
    question: `${gloss}。（猜成语）`,
    answer: word,
    hint: '共 4 个字',
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
