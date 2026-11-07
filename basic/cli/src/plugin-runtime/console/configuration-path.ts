import { CONFIG_PATCH_LIMITS } from '@zhin.js/console-protocol';

const forbidden = Object.freeze(['__proto__', 'constructor', 'prototype']);
const simpleSegment = /^[A-Za-z0-9_-]+$/u;

/** One immutable policy for parsed, structured-write and chat-read paths. */
export function isForbiddenConfigurationPathSegment(segment: string): boolean {
  return forbidden.includes(segment);
}

/** JSON Pointer preserves literal dots and slashes; dotted paths cover simple fields. */
export function parseConfigurationPath(input: string): readonly string[] {
  if (typeof input !== 'string') throw new TypeError('Invalid configuration path');
  if (input === '') return Object.freeze([]);
  const pointer = input.startsWith('/');
  const segments = pointer ? input.slice(1).split('/').map(segment => {
    if (/~(?![01])/u.test(segment)) throw new TypeError('Invalid configuration path');
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
  }) : input.split('.');
  if (segments.length > CONFIG_PATCH_LIMITS.maxPathDepth || segments.some(segment => !segment
    || segment.length > CONFIG_PATCH_LIMITS.maxSegmentLength || isForbiddenConfigurationPathSegment(segment)
    || /[\u0000-\u001f\u007f]/u.test(segment) || (!pointer && !simpleSegment.test(segment)))) {
    throw new TypeError('Invalid configuration path');
  }
  return Object.freeze(segments);
}

/** Lossless text, or undefined when the parser cannot address it. Callers quote token delimiters. */
export function formatConfigurationPath(path: readonly string[]): string | undefined {
  const text = path.every(segment => simpleSegment.test(segment)) ? path.join('.')
    : `/${path.map(segment => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
  try { parseConfigurationPath(text); }
  catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
  return text;
}
