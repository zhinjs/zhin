import { untrustedContent, type SendContent } from '@zhin.js/core/runtime';

/**
 * zhinjs/zhin#1250: a plain command reply is an outbound template, so a stored question, answer,
 * keyword or nickname copied into it would be expanded (`你好 ${sender.name}` shown as `你好 Admin`).
 * Replies that quote such data build their text with {@link Echo.mark} and send each quoted value as
 * untrusted content: only the plugin's own wording is a template, the quoted data reaches the
 * user exactly as stored.
 */
const ECHO_TRUST = Object.freeze({ source: 'group-suite.echo' });
/** Private-use code point: never part of the plugin's own wording, stripped from quoted values. */
const MARK = '\u{F0000}';
const MARKED = new RegExp(`${MARK}(\\d+)${MARK}`, 'gu');

export interface Echo {
  /** A placeholder for `value` to put in the reply text (in place of the value itself). */
  mark(value: unknown): string;
  /** The reply: the text as a template, every marked value as literal (untrusted) content. */
  content(text: string): SendContent;
}

export function createEcho(): Echo {
  const values: string[] = [];
  return {
    mark(value) {
      values.push(String(value ?? '').replaceAll(MARK, ''));
      return `${MARK}${values.length - 1}${MARK}`;
    },
    content(text) {
      const parts: SendContent[] = [];
      let last = 0;
      for (const found of text.matchAll(MARKED)) {
        const index = found.index ?? 0;
        if (index > last) parts.push(text.slice(last, index));
        last = index + found[0].length;
        const value = values[Number(found[1])] ?? '';
        if (value) parts.push(untrustedContent(value, ECHO_TRUST));
      }
      if (last < text.length) parts.push(text.slice(last));
      if (parts.length === 0) return '';
      if (parts.length === 1 && typeof parts[0] === 'string') return parts[0];
      return parts;
    },
  };
}

/** One-shot form: `echoReply(m => t(locale, 'key', { question: m(question) }))`. */
export function echoReply(build: (mark: Echo['mark']) => string): SendContent {
  const echo = createEcho();
  return echo.content(build(value => echo.mark(value)));
}
