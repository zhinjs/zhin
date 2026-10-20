import type { ExtractedContent } from './extract.js';
import type { ExtractedImage, TextMatch } from './types.js';

export interface RedactOptions {
  readonly maskChar: string;
  readonly matches: readonly TextMatch[];
  readonly flaggedImageIndexes: readonly number[];
}

/**
 * Mask matched spans in text. When there are no spans but redact is requested
 * for non-empty text, replace the whole string with mask chars.
 */
export function redactText(
  text: string,
  matches: readonly TextMatch[],
  maskChar: string,
): string {
  const ch = maskChar.slice(0, 1) || '*';
  if (!text) return text;
  if (!matches.length) {
    const len = Math.max(3, Math.min(text.length, 16));
    return ch.repeat(len);
  }

  const chars = [...text];
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  for (const match of sorted) {
    const start = Math.max(0, Math.min(chars.length, match.start));
    const end = Math.max(start, Math.min(chars.length, match.end));
    for (let i = start; i < end; i++) chars[i] = ch;
  }
  return chars.join('');
}

/**
 * Apply text masking + remove flagged image segments from outbound payload.
 */
export function redactOutboundPayload(
  payload: unknown,
  extracted: ExtractedContent,
  options: RedactOptions,
): unknown {
  const flagged = new Set(options.flaggedImageIndexes);
  const flaggedSegmentIndexes = new Set(
    extracted.images
      .filter((img) => flagged.has(img.index) && img.segmentIndex != null)
      .map((img) => img.segmentIndex as number),
  );

  if (typeof payload === 'string') {
    return redactText(payload, options.matches, options.maskChar);
  }

  if (Array.isArray(payload)) {
    return redactSegmentList(payload, options, flaggedSegmentIndexes);
  }

  if (payload && typeof payload === 'object' && 'type' in payload) {
    const list = redactSegmentList([payload], options, flaggedSegmentIndexes);
    return list.length === 1 ? list[0] : list;
  }

  if (extracted.text) {
    return redactText(extracted.text, options.matches, options.maskChar);
  }
  return payload;
}

function redactSegmentList(
  segments: readonly unknown[],
  options: RedactOptions,
  flaggedSegmentIndexes: ReadonlySet<number>,
): unknown[] {
  const out: unknown[] = [];
  let textCursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || typeof seg !== 'object') {
      out.push(seg);
      continue;
    }
    if (flaggedSegmentIndexes.has(i)) continue;

    const record = seg as Record<string, unknown>;
    const type = String(record.type ?? '');
    if (type === 'text') {
      const data = asRecord(record.data);
      const text = typeof data.text === 'string' ? data.text : '';
      const localMatches = shiftMatches(options.matches, textCursor, text.length);
      // No spans overall → whole-segment mask; otherwise only mask local hits.
      const nextText = options.matches.length === 0
        ? redactText(text, [], options.maskChar)
        : localMatches.length > 0
          ? redactText(text, localMatches, options.maskChar)
          : text;
      out.push({
        ...record,
        data: { ...data, text: nextText },
      });
      textCursor += text.length;
      continue;
    }

    out.push(seg);
  }

  return out;
}

function shiftMatches(
  matches: readonly TextMatch[],
  offset: number,
  length: number,
): TextMatch[] {
  const end = offset + length;
  const out: TextMatch[] = [];
  for (const m of matches) {
    if (m.end <= offset || m.start >= end) continue;
    out.push({
      start: Math.max(0, m.start - offset),
      end: Math.min(length, m.end - offset),
    });
  }
  return out;
}

export function flaggedImagesFromIndexes(
  images: readonly ExtractedImage[],
  indexes: readonly number[],
): readonly ExtractedImage[] {
  const set = new Set(indexes);
  return Object.freeze(images.filter((img) => set.has(img.index)));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
