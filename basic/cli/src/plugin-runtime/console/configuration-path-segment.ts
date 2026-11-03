const forbidden = Object.freeze(['__proto__', 'constructor', 'prototype']);

/** One immutable policy for parsed, structured-write and chat-read paths. */
export function isForbiddenConfigurationPathSegment(segment: string): boolean {
  return forbidden.includes(segment);
}
