/**
 * Approximates npm's `files` matching well enough for `zhin plugin check`: a plain entry matches the
 * path itself or anything below it (directories), `*` matches within one segment and `**` across
 * segments. Negated entries (`!pattern`) exclude. The pack step stays authoritative.
 */

function normalizeWhitelistPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
}

function globToRegExp(pattern: string): RegExp {
  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      const followedBySlash = pattern[index + 2] === '/';
      expression += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 3 : 2;
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
    }
    index += 1;
  }
  // A matching directory includes everything below it.
  return new RegExp(`^${expression}(?:/.*)?$`, 'u');
}

/** Whether a package-relative path is included by a `files` whitelist. */
export function filesWhitelistIncludes(files: ReadonlyArray<string>, target: string): boolean {
  const normalizedTarget = normalizeWhitelistPath(target);
  let included = false;
  for (const rawEntry of files) {
    const negated = rawEntry.startsWith('!');
    const entry = normalizeWhitelistPath(negated ? rawEntry.slice(1) : rawEntry);
    if (entry === '') continue;
    if (!globToRegExp(entry).test(normalizedTarget)) continue;
    included = !negated;
  }
  return included;
}
