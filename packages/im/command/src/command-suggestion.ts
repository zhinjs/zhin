/**
 * Near-miss command suggestions (issue #1250).
 *
 * A message whose first words look like a registered command name or alias, but did not
 * route, is answered with "did you mean" instead of being handed to the AI (which then
 * tends to invent command names). The matching is deliberately conservative:
 *
 * - names compare case-insensitively with spaces, `-` and `_` removed, so `rss-list`,
 *   `rss list`, `RSS List` and `rsslist` are the same name;
 * - an identical normalized name always counts;
 * - one edit counts only for names of at least {@link MIN_LENGTH_FOR_ONE_EDIT} characters
 *   (CJK: {@link MIN_CJK_LENGTH_FOR_ONE_EDIT}), two edits only when configured and only for
 *   names of at least {@link MIN_LENGTH_FOR_TWO_EDITS} characters;
 * - a first word that is the whole leading word of a multi-word name (`qrcode …` for
 *   `qrcode gen`, `rss …` for `rss-list`) also counts, used only when no name is within the edit distance;
 * - after the name, the message may carry at most the command's declared arguments plus one word,
 *   so ordinary sentences that merely start with a similar word stay chat.
 */

/** Root config `commandSuggestion`: `false` disables suggestions; an object tunes them. */
export interface CommandSuggestionConfig {
  readonly enabled?: boolean;
  /** Largest edit distance still suggested (0–2, default 1). */
  readonly maxDistance?: number;
  /** Most names listed in one reply (1–5, default 3). */
  readonly limit?: number;
}

export interface ResolvedCommandSuggestionConfig {
  readonly enabled: boolean;
  readonly maxDistance: number;
  readonly limit: number;
}

export const DEFAULT_COMMAND_SUGGESTION: ResolvedCommandSuggestionConfig = Object.freeze({
  enabled: true, maxDistance: 1, limit: 3,
});

const MIN_LENGTH_FOR_ONE_EDIT = 5;
const MIN_CJK_LENGTH_FOR_ONE_EDIT = 3;
const MIN_LENGTH_FOR_TWO_EDITS = 8;
const MAX_INPUT_LENGTH = 64;
const MIN_NAMESPACE_LENGTH = 3;
const NAMESPACE_DISTANCE = 3;

/** Normalize the root config value; unknown shapes fall back to the defaults. */
export function resolveCommandSuggestionConfig(value: unknown): ResolvedCommandSuggestionConfig {
  if (value === false) return Object.freeze({ ...DEFAULT_COMMAND_SUGGESTION, enabled: false });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_COMMAND_SUGGESTION;
  const raw = value as CommandSuggestionConfig;
  const integer = (input: unknown, min: number, max: number, fallback: number): number =>
    typeof input === 'number' && Number.isInteger(input) ? Math.min(max, Math.max(min, input)) : fallback;
  return Object.freeze({
    enabled: raw.enabled !== false,
    maxDistance: integer(raw.maxDistance, 0, 2, DEFAULT_COMMAND_SUGGESTION.maxDistance),
    limit: integer(raw.limit, 1, 5, DEFAULT_COMMAND_SUGGESTION.limit),
  });
}

export function normalizeCommandName(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/gu, '');
}

const CJK = /[㐀-鿿豈-﫿]/u;

/** Largest distance accepted for one normalized name, given the configured ceiling. */
export function allowedCommandDistance(normalizedName: string, maxDistance: number): number {
  const length = [...normalizedName].length;
  if (maxDistance >= 2 && length >= MIN_LENGTH_FOR_TWO_EDITS) return 2;
  const minimum = CJK.test(normalizedName) ? MIN_CJK_LENGTH_FOR_ONE_EDIT : MIN_LENGTH_FOR_ONE_EDIT;
  return maxDistance >= 1 && length >= minimum ? 1 : 0;
}

/** Code-point Levenshtein distance; stops early once `limit` is exceeded. */
export function commandNameDistance(left: string, right: string, limit = Number.POSITIVE_INFINITY): number {
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j++) {
      const value = Math.min((previous[j] ?? Infinity) + 1, (current[j - 1] ?? Infinity) + 1,
        (previous[j - 1] ?? Infinity) + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}

export interface CommandNameCandidate<T> {
  readonly value: T;
  /** Static words of one route (primary or alias), e.g. `['rss', 'list']`. */
  readonly words: readonly string[];
  /** Arguments the command declares; bounds how many extra words a near miss may carry. */
  readonly arity: number;
}

/**
 * Rank candidates whose name resembles the start of `text`. Returns each distinct
 * candidate value once, best match first.
 */
export function rankCommandSuggestions<T>(
  text: string,
  candidates: readonly CommandNameCandidate<T>[],
  config: ResolvedCommandSuggestionConfig,
): readonly T[] {
  const trimmed = text.trim();
  if (!config.enabled || !trimmed || trimmed.length > MAX_INPUT_LENGTH || /[\r\n]/u.test(trimmed)) return [];
  const words = trimmed.split(/\s+/u);
  const best = new Map<T, number>();
  for (const candidate of candidates) {
    if (candidate.words.length === 0) continue;
    const name = normalizeCommandName(candidate.words.join(''));
    if (!name) continue;
    const allowed = allowedCommandDistance(name, config.maxDistance);
    let distance = Number.POSITIVE_INFINITY;
    // The name may be typed with its words split differently (`rss list` for `rss-list`).
    for (let taken = 1; taken <= Math.min(words.length, candidate.words.length + 1); taken++) {
      if (words.length - taken > candidate.arity + 1) continue;
      const head = normalizeCommandName(words.slice(0, taken).join(''));
      if (head) distance = Math.min(distance, commandNameDistance(head, name, allowed));
    }
    if (distance > allowed) {
      // Namespace match (`qrcode hello` for `qrcode gen`, `rss foo` for `rss-list`): the first
      // word is a whole leading word of a multi-word name; used only without an edit match.
      if (!namespaceMatches(words, candidate)) continue;
      distance = NAMESPACE_DISTANCE;
    }
    const previous = best.get(candidate.value);
    if (previous === undefined || distance < previous) best.set(candidate.value, distance);
  }
  // Namespace matches only stand in when nothing resembles the name itself.
  const close = [...best.entries()].filter(([, distance]) => distance < NAMESPACE_DISTANCE);
  return (close.length > 0 ? close : [...best.entries()])
    .sort((left, right) => left[1] - right[1])
    .slice(0, config.limit)
    .map(([value]) => value);
}

function namespaceMatches<T>(words: readonly string[], candidate: CommandNameCandidate<T>): boolean {
  const nameWords = candidate.words.flatMap(word => word.split(/[-_]+/u)).filter(Boolean);
  const namespace = nameWords[0];
  if (nameWords.length < 2 || !namespace || [...namespace].length < MIN_NAMESPACE_LENGTH) return false;
  if (words.length > nameWords.length + candidate.arity) return false;
  return normalizeCommandName(words[0] ?? '') === normalizeCommandName(namespace);
}

