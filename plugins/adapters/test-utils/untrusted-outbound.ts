import { isUntrustedContent, type SendRequest } from '../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { expect } from 'vitest';

/**
 * Agent tools deliver model-built content as `untrustedContent(...)` (ADR 0056 §2). Test doubles of
 * the outbound service assert that wrapping and hand the inner content to the original mock.
 */
export function expectUntrustedSend<T>(send: (request: SendRequest) => T, source?: string): (request: SendRequest) => T {
  return (request) => {
    expect(isUntrustedContent(request.content)).toBe(true);
    const wrapped = request.content as Extract<SendRequest['content'], { readonly trust: unknown }>;
    if (source) expect(wrapped.trust.source).toBe(source);
    return send({ ...request, content: wrapped.content });
  };
}
