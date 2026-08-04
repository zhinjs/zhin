import { describe, expect, it } from 'vitest';
import { resolveSessionInteractionPort } from '../../src/session/resolve-session-interaction-port.js';

describe('resolveSessionInteractionPort', () => {
  it('uses an injected host ApprovalPort and exposes no channel when no fallback exists', () => {
    const port = { requestApproval: async () => true };
    expect(resolveSessionInteractionPort({} as any, undefined, undefined, port)).toBe(port);
    expect(resolveSessionInteractionPort({} as any, undefined)).toBeUndefined();
  });
});
