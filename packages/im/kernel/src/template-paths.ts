/**
 * Whitelist `${path}` substitution. No expression evaluation: a placeholder is
 * replaced only when it is a plain property path that resolves, through own
 * enumerable properties, to a defined non-function value. Everything else is
 * left in the output exactly as written.
 */

const PLACEHOLDER = /\$\{([^{}]*)\}/g;
const PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const SEGMENT = /[A-Za-z_$][\w$]*|\d+/g;
const BLOCKED_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const UNRESOLVED = Symbol('unresolved');

export function renderTemplatePaths(template: string, context: Readonly<Record<string, unknown>>): string {
  if (!template.includes('${')) return template;
  // A single pass: substituted values are never rescanned for placeholders.
  return template.replace(PLACEHOLDER, (placeholder, body: string) => {
    const value = resolveTemplatePath(body.trim(), context);
    return value === UNRESOLVED ? placeholder : value;
  });
}

function resolveTemplatePath(path: string, context: Readonly<Record<string, unknown>>): string | typeof UNRESOLVED {
  if (!PATH.test(path)) return UNRESOLVED;
  let current: unknown = context;
  for (const segment of path.match(SEGMENT) ?? []) {
    if (BLOCKED_SEGMENTS.has(segment)) return UNRESOLVED;
    if (current === null || typeof current !== 'object') return UNRESOLVED;
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    // Data properties only: an accessor would run author code during rendering.
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return UNRESOLVED;
    current = descriptor.value;
  }
  return formatTemplateValue(current);
}

function formatTemplateValue(value: unknown): string | typeof UNRESOLVED {
  switch (typeof value) {
    case 'string': return value;
    case 'number':
    case 'boolean': return String(value);
    case 'object': {
      if (value === null || !isPlainData(value)) return UNRESOLVED;
      try {
        return JSON.stringify(value, null, 2) ?? UNRESOLVED;
      } catch {
        return UNRESOLVED;
      }
    }
    default: return UNRESOLVED;
  }
}

function isPlainData(value: object): boolean {
  if (Array.isArray(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
