/**
 * Lenient recovery of a JSON object a model wrote as text instead of through structured output.
 */

/**
 * The first JSON object in `text` with its brackets repaired: closers that match no open bracket
 * are dropped, brackets still open at the end are closed, and anything after the object closes
 * (a code fence, a trailing remark) is cut. Undefined when a string is left unterminated.
 */
function balancedJsonObject(text: string): string | undefined {
  const stack: string[] = [];
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.at(-1) !== ch) continue;
      stack.pop();
      if (stack.length === 0) return out + ch;
    }
    out += ch;
  }
  return inString ? undefined : out + stack.reverse().join('');
}

/**
 * Models that write the structured answer as text (MiniMax ignores the SDK's json tool) often wrap
 * it in a sentence or a code fence, or get a bracket wrong. Recover the first parseable object;
 * the caller still validates it against the schema.
 */
export function parseLenientJsonObject(text: string): Record<string, unknown> | undefined {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const candidate = balancedJsonObject(text.slice(start));
    if (candidate === undefined) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* try the next opening brace */ }
  }
  return undefined;
}
