/**
 * Length-preserving comment stripper for the harness checks (`check:harness-paths`,
 * `check:no-removed-plugin-api`, `check:no-platform-branches`). The self-change trial
 * (`packages/im/agent/src/self-change/trial.ts`, `stripCommentsForRules`) carries a line-for-line
 * copy; `scripts/check-im-send-bypass.test.ts` asserts the two give identical output.
 *
 * A single linear scan that knows string literals (`'…'`, `"…"`), template literals (with nested
 * `${ … }` code, which may itself hold comments and templates) and regular-expression literals, so a
 * comment marker inside any of them (`'a//'`, `"/*"`, `/\/\//`) is not a comment. Every comment
 * character becomes a space and newlines are kept, so offsets and line numbers of the result match the
 * source. String, template and regex contents are kept as they are (import specifiers and bracketed
 * member names such as `endpoint['send']` live in strings).
 *
 * Fail-closed choices: an unclosed `/*` leaves the rest of the source as code; an unterminated `'` / `"`
 * string ends at the line break; a `/` is a regex only after an operator, an opening bracket, a comma
 * or a keyword such as `return`, never after an identifier, a literal or a closing bracket. JSX text
 * is not modelled (an apostrophe in JSX text opens a string up to the end of its line); this is a lint
 * heuristic, not a parser.
 */

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const IDENT = /[\w$]/u;

/**
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  const length = source.length;
  /** @type {string[]} */
  const out = [];
  let index = 0;
  let copied = 0;
  // Brace depth of the code currently being scanned; one entry per enclosing `${` of a template.
  /** @type {number[]} */
  const templateDepths = [];
  let depth = 0;
  // `true` when a `/` at this point starts a regex literal rather than a division.
  let regexAllowed = true;

  const blank = (from, to) => {
    out.push(source.slice(copied, from), source.slice(from, to).split('\n').map((part) => ' '.repeat(part.length)).join('\n'));
    copied = to;
  };

  /** Scans template text from `from` (just after a backtick or a closing `}`); returns the index after it. */
  const scanTemplate = (from) => {
    let at = from;
    while (at < length) {
      const char = source[at];
      if (char === '\\') { at += 2; continue; }
      if (char === '`') return { end: at + 1, open: false };
      if (char === '$' && source[at + 1] === '{') return { end: at + 2, open: true };
      at += 1;
    }
    return { end: length, open: false };
  };

  const enterTemplate = (from) => {
    const scanned = scanTemplate(from);
    index = scanned.end;
    if (scanned.open) {
      templateDepths.push(depth);
      depth = 0;
      regexAllowed = true;
    } else {
      regexAllowed = false;
    }
  };

  while (index < length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === '/' && next === '/') {
      const newline = source.indexOf('\n', index);
      const end = newline < 0 ? length : newline;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) break; // unclosed: the rest stays code
      blank(index, close + 2);
      index = close + 2;
      continue;
    }
    if (char === '\'' || char === '"') {
      let at = index + 1;
      while (at < length && source[at] !== char && source[at] !== '\n') at += source[at] === '\\' ? 2 : 1;
      index = Math.min(length, at + 1);
      regexAllowed = false;
      continue;
    }
    if (char === '`') {
      enterTemplate(index + 1);
      continue;
    }
    if (char === '/' && regexAllowed) {
      let at = index + 1;
      let inClass = false;
      let closed = false;
      while (at < length && source[at] !== '\n') {
        const current = source[at];
        if (current === '\\') { at += 2; continue; }
        if (current === '[') inClass = true;
        else if (current === ']') inClass = false;
        else if (current === '/' && !inClass) { closed = true; break; }
        at += 1;
      }
      if (closed) {
        at += 1;
        while (at < length && IDENT.test(source[at])) at += 1;
        index = at;
        regexAllowed = false;
        continue;
      }
      // Not a regex after all: an operator.
      index += 1;
      regexAllowed = true;
      continue;
    }
    if (IDENT.test(char)) {
      let at = index + 1;
      while (at < length && IDENT.test(source[at])) at += 1;
      regexAllowed = REGEX_KEYWORDS.has(source.slice(index, at));
      index = at;
      continue;
    }
    if (char === '{') {
      depth += 1;
      regexAllowed = true;
      index += 1;
      continue;
    }
    if (char === '}') {
      if (depth === 0 && templateDepths.length > 0) {
        depth = templateDepths.pop();
        enterTemplate(index + 1);
        continue;
      }
      depth = Math.max(0, depth - 1);
      regexAllowed = false;
      index += 1;
      continue;
    }
    if (char === ')' || char === ']') regexAllowed = false;
    else if (!/\s/u.test(char)) regexAllowed = true;
    index += 1;
  }
  out.push(source.slice(copied));
  return out.join('');
}
