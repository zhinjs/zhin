import { untrustedContent, type SendContent } from '@zhin.js/core';

/**
 * #1250: text the Host sends outside a turn (approval cards, group-rule cards, their replies) mixes the
 * framework's own catalog text with values a user, the model or a plugin supplied (a diff excerpt, tool
 * arguments, a summary, a rule's notes, an echoed key). Plain strings are template-compiled on the way
 * out, so such a value is sent as {@link untrustedContent} — literal, never compiled — and kept on one line
 * (line breaks shown as ` ⏎ `), so it can neither change what the card says nor start a line of its own
 * that reads like a framework command line («批准：…»).
 */

const LITERAL_TRUST = Object.freeze({ source: 'agent:card-literal' });
const LINE_BREAKS = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/gu;
const literalBrand: unique symbol = Symbol('zhin.card-literal');

export interface CardLiteral {
  readonly [literalBrand]: string;
}

/** A user / model / plugin value inside a card line. */
export function cardLiteral(value: unknown): CardLiteral {
  return Object.freeze({ [literalBrand]: String(value ?? '') });
}

/** One line: line breaks inside the value are shown as ` ⏎ `. */
export function singleLine(text: string): string {
  return text.replace(LINE_BREAKS, ' ⏎ ');
}

function isCardLiteral(value: unknown): value is CardLiteral {
  return typeof value === 'object' && value !== null && literalBrand in value;
}

function literalContent(text: string): SendContent {
  return untrustedContent(singleLine(text), LITERAL_TRUST);
}

export type CardValues = Readonly<Record<string, string | number | CardLiteral>>;

/** A content piece: a framework string, or a literal piece. Plain string when nothing is literal. */
export type CardLine = string | readonly SendContent[];

/** Private-use markers: never part of catalog text or of the framework values a card interpolates. */
const SENTINEL = /\uE000(\d+)\uE001/u;

/**
 * Formats one catalog entry: framework text stays a template-capable string, every {@link CardLiteral}
 * value becomes its own literal piece. `format` is a `createMessages` translator bound to a locale.
 */
export function cardLine(format: (values: Readonly<Record<string, string | number>>) => string, values: CardValues = {}): CardLine {
  const literals: string[] = [];
  const plain: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isCardLiteral(value)) {
      plain[key] = `\uE000${literals.length}\uE001`;
      literals.push(value[literalBrand]);
    } else plain[key] = value;
  }
  const text = format(plain);
  if (literals.length === 0) return text;
  const pieces: SendContent[] = [];
  const parts = text.split(SENTINEL);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (index % 2 === 0) {
      if (part) pieces.push(part);
    } else {
      pieces.push(literalContent(literals[Number(part)] ?? ''));
    }
  }
  return Object.freeze(pieces);
}

/** A quoted block: each line of `text` as its own `│ `-prefixed line (the marker is framework text). */
export function quotedLines(text: string): readonly CardLine[] {
  return text.split(LINE_BREAKS).map(line => Object.freeze(['│ ', literalContent(line)]));
}

/**
 * Joins lines with `\n` (skipping `undefined` / empty ones). Returns a plain string when no line has a
 * literal piece, so fixed replies stay strings.
 */
export function joinCardLines(lines: readonly (CardLine | undefined | false)[]): CardLine {
  const kept = lines.filter((line): line is CardLine => typeof line === 'string' ? line.length > 0 : Array.isArray(line));
  if (kept.every(line => typeof line === 'string')) return (kept as string[]).join('\n');
  const pieces: SendContent[] = [];
  kept.forEach((line, index) => {
    if (index > 0) pieces.push('\n');
    if (typeof line === 'string') pieces.push(line);
    else pieces.push(...line);
  });
  return Object.freeze(pieces);
}
