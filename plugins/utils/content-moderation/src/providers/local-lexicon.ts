import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { maxSeverity, type LocalSourceConfig, type ProviderResult, type ScanInput, type TextMatch } from '../types.js';
import type { LexiconEntry, LexiconSeverity } from './builtin-lexicon.js';
import { BUILTIN_LEXICON, mergeLexiconEntries } from './builtin-lexicon.js';
import type { ModerationProvider } from './types.js';

export interface GradedMatch extends TextMatch {
  readonly word: string;
  readonly severity: LexiconSeverity;
}

export class LocalLexiconProvider implements ModerationProvider {
  readonly id: string;
  readonly #entries: readonly LexiconEntry[];
  readonly #onError: LocalSourceConfig['onError'];

  constructor(config: LocalSourceConfig, cwd: string = process.cwd()) {
    this.id = config.id;
    this.#onError = config.onError;
    this.#entries = Object.freeze(loadLexiconEntries(config, cwd));
  }

  async scan(input: ScanInput): Promise<ProviderResult> {
    try {
      const matches = findGradedMatches(input.text, this.#entries);
      if (matches.length === 0) {
        return Object.freeze({
          sourceId: this.id,
          severity: 'pass' as const,
        });
      }
      let severity: LexiconSeverity = matches[0]!.severity;
      for (const match of matches) {
        severity = maxSeverity(severity, match.severity) as LexiconSeverity;
      }
      return Object.freeze({
        sourceId: this.id,
        severity,
        matches: Object.freeze(matches.map(({ start, end }) => ({ start, end }))),
        reason: `lexicon hit (${matches.length}, max=${severity})`,
      });
    } catch (error) {
      return Object.freeze({
        sourceId: this.id,
        severity: this.#onError === 'closed' ? 'critical' as const : 'pass' as const,
        error: true,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function loadLexiconEntries(config: LocalSourceConfig, cwd: string): readonly LexiconEntry[] {
  const custom: LexiconEntry[] = [];
  for (const item of config.words) {
    custom.push({ word: item.word, severity: item.severity });
  }
  for (const file of config.wordFiles) {
    custom.push(...parseWordFile(readFileSync(resolve(cwd, file), 'utf8'), config.defaultSeverity));
  }
  const builtin = config.includeBuiltin ? BUILTIN_LEXICON : undefined;
  return mergeLexiconEntries(builtin, custom);
}

/** @deprecated Use loadLexiconEntries; kept for tests that only need bare words. */
export function loadWords(config: LocalSourceConfig, cwd: string): string[] {
  return loadLexiconEntries(config, cwd).map((e) => e.word);
}

export function findMatches(text: string, words: readonly string[]): readonly TextMatch[] {
  const entries = words.map((word) => ({ word, severity: 'high' as const }));
  return findGradedMatches(text, entries).map(({ start, end }) => ({ start, end }));
}

export function findGradedMatches(
  text: string,
  entries: readonly LexiconEntry[],
): readonly GradedMatch[] {
  if (!text || entries.length === 0) return Object.freeze([]);
  const matches: GradedMatch[] = [];
  for (const entry of entries) {
    if (!entry.word) continue;
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(entry.word, from);
      if (idx < 0) break;
      matches.push({
        start: idx,
        end: idx + entry.word.length,
        word: entry.word,
        severity: entry.severity,
      });
      from = idx + entry.word.length;
    }
  }
  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  return Object.freeze(matches);
}

/**
 * Word-file lines:
 * - `# comment`
 * - `word`                         → defaultSeverity
 * - `severity:word`                 → graded（low|medium|high|critical）
 * - `word|severity`                 → graded
 */
export function parseWordFile(
  content: string,
  defaultSeverity: LexiconSeverity,
): LexiconEntry[] {
  const out: LexiconEntry[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseWordLine(trimmed, defaultSeverity);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function parseWordLine(
  line: string,
  defaultSeverity: LexiconSeverity,
): LexiconEntry | null {
  const pipe = line.indexOf('|');
  if (pipe > 0) {
    const word = line.slice(0, pipe).trim();
    const severity = parseSeverityToken(line.slice(pipe + 1).trim()) ?? defaultSeverity;
    return word ? { word, severity } : null;
  }
  const colon = line.indexOf(':');
  if (colon > 0) {
    const maybeSeverity = parseSeverityToken(line.slice(0, colon).trim());
    if (maybeSeverity) {
      const word = line.slice(colon + 1).trim();
      return word ? { word, severity: maybeSeverity } : null;
    }
  }
  return { word: line, severity: defaultSeverity };
}

function parseSeverityToken(value: string): LexiconSeverity | null {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') {
    return value;
  }
  return null;
}
