/**
 * 成语词库适配层 — 基于 npm `chinese-idiom-chengyu`（MIT，~3 万成语）
 * @see https://www.npmjs.com/package/chinese-idiom-chengyu
 */
import { createRequire } from 'node:module';
import { secureRandomItem } from '@zhin.js/game-kit';

const require = createRequire(import.meta.url);

export type MatchMode = 'char' | 'pinyin';

export interface IdiomEntry {
  text: string;
  gloss?: string;
}

interface ChengyuLib {
  nextIdiomsWithMatchingCharacter: (word: string, opts: { word: boolean; pinyin: boolean }) => string[];
  nextIdiomsWithMatchingNoTonePinyin: (word: string, opts: { word: boolean; pinyin: boolean }) => string[];
  getDefinition: (word: string) => string;
}

const chengyu = require('chinese-idiom-chengyu') as ChengyuLib;
const { WORD_PINYIN_MAP } = require('chinese-idiom-chengyu/src/tools/parse.js') as {
  WORD_PINYIN_MAP: Map<string, string>;
};
const Util = require('chinese-idiom-chengyu/src/tools/util.js') as {
  pinyinToLetters: (pinyin: string) => string;
};

const FOUR_CHAR = /^[\u4e00-\u9fff]{4}$/;
const SEARCH_OPTS = { word: true, pinyin: false } as const;

let fourCharPool: string[] | null = null;

function buildFourCharPool(): string[] {
  if (fourCharPool) return fourCharPool;
  const pool: string[] = [];
  for (const word of WORD_PINYIN_MAP.keys()) {
    if (FOUR_CHAR.test(word)) pool.push(word);
  }
  fourCharPool = pool;
  return pool;
}

export function idiomCount(): number {
  return buildFourCharPool().length;
}

export function normalizeInput(raw: string): string {
  return raw.trim().replace(/\s/g, '');
}

export function isKnownIdiom(text: string): boolean {
  return WORD_PINYIN_MAP.has(text);
}

export function getGloss(text: string): string | undefined {
  try {
    return chengyu.getDefinition(text);
  } catch {
    return undefined;
  }
}

export function lastChar(idiom: string): string {
  return idiom[idiom.length - 1]!;
}

export function lastSyllableNoTone(idiom: string): string {
  const py = WORD_PINYIN_MAP.get(idiom);
  if (!py) return '';
  const tail = py.split(' ').pop() ?? '';
  return Util.pinyinToLetters(tail);
}

export function modeLabel(mode: MatchMode): string {
  return mode === 'char' ? '同字接龙' : '同音接龙';
}

export function getValidNext(
  prevIdiom: string,
  mode: MatchMode,
  used: Set<string>,
): IdiomEntry[] {
  if (!WORD_PINYIN_MAP.has(prevIdiom)) return [];

  const raw =
    mode === 'char'
      ? chengyu.nextIdiomsWithMatchingCharacter(prevIdiom, SEARCH_OPTS)
      : chengyu.nextIdiomsWithMatchingNoTonePinyin(prevIdiom, SEARCH_OPTS);

  return raw
    .filter((w) => FOUR_CHAR.test(w) && !used.has(w))
    .map((text) => ({ text, gloss: getGloss(text) }));
}

export function pickBotIdiom(
  prevIdiom: string,
  mode: MatchMode,
  used: Set<string>,
): IdiomEntry | null {
  const candidates = getValidNext(prevIdiom, mode, used);
  if (!candidates.length) return null;
  return secureRandomItem(candidates);
}

export function pickStarterIdiom(used: Set<string>): IdiomEntry {
  const pool = buildFourCharPool().filter((w) => !used.has(w));
  const text = pool.length > 0 ? secureRandomItem(pool) : '一心一意';
  return { text, gloss: getGloss(text) };
}

export function pickHintIdiom(
  prevIdiom: string,
  mode: MatchMode,
  used: Set<string>,
): string | null {
  return pickBotIdiom(prevIdiom, mode, used)?.text ?? null;
}

export interface ValidateResult {
  ok: boolean;
  reason?: string;
}

export function validatePlayerIdiom(
  text: string,
  prevIdiom: string,
  mode: MatchMode,
  used: Set<string>,
): ValidateResult {
  const idiom = normalizeInput(text);
  if (!FOUR_CHAR.test(idiom)) {
    return { ok: false, reason: '请输入**四字成语**（不要空格或标点）。' };
  }
  if (!isKnownIdiom(idiom)) {
    return { ok: false, reason: '开源词库中未收录该成语，请换一个常见四字成语。' };
  }
  if (used.has(idiom)) {
    return { ok: false, reason: '这个成语本局已经用过了。' };
  }

  const valid = getValidNext(prevIdiom, mode, used);
  if (valid.some((v) => v.text === idiom)) return { ok: true };

  const tail = lastChar(prevIdiom);
  if (mode === 'char') {
    return { ok: false, reason: `必须以「**${tail}**」开头（上一句尾字）。` };
  }

  const py = lastSyllableNoTone(prevIdiom);
  return {
    ok: false,
    reason: `首字需**同音**（${py}），如「${tail}」音；也可同字「${tail}」开头。`,
  };
}

export function promptLine(prevIdiom: string, mode: MatchMode): string {
  const tail = lastChar(prevIdiom);
  if (mode === 'char') {
    return `请接「**${tail}**」字开头的四字成语`;
  }
  const py = lastSyllableNoTone(prevIdiom);
  return `请接**同音**「${py}」（尾字「${tail}」）开头的四字成语`;
}
