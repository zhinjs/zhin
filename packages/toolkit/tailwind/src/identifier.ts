// CSSOM identifier serialization, also used by Tailwind for utility selectors.
// https://drafts.csswg.org/cssom/#serialize-an-identifier
export function escapeIdentifier(value: string): string {
  if (value === "-") return "\\-";
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) result += "\uFFFD";
    else if (
      code < 32 ||
      code === 127 ||
      (code >= 48 &&
        code <= 57 &&
        (index === 0 || (index === 1 && value[0] === "-")))
    ) {
      result += `\\${code.toString(16)} `;
    } else if (code >= 128 || /[\w-]/.test(value[index]))
      result += value[index];
    else result += `\\${value[index]}`;
  }
  return result;
}

/** Colons inside arbitrary values are values, not Tailwind variants. */
export function hasVariant(candidate: string): boolean {
  let depth = 0;
  for (let index = 0; index < candidate.length; index++) {
    const char = candidate[index];
    if (char === "\\") {
      index++;
      continue;
    }
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) return true;
  }
  return false;
}
