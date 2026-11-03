import { CONFIG_PATCH_LIMITS } from '@zhin.js/console-protocol';

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
    || segment.length > CONFIG_PATCH_LIMITS.maxSegmentLength || ['__proto__', 'constructor', 'prototype'].includes(segment)
    || /[\u0000-\u001f\u007f]/u.test(segment) || (!pointer && !/^[A-Za-z0-9_-]+$/u.test(segment)))) {
    throw new TypeError('Invalid configuration path');
  }
  return Object.freeze(segments);
}
