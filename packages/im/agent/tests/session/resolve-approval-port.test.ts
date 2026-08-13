import { describe, expect, it } from 'vitest';
import { resolveApprovalPort } from '../../src/session/resolve-approval-port.js';

describe('resolveApprovalPort', () => {
  it('uses an explicit host ApprovalPort and exposes no implicit IM fallback', () => {
    const port = { requestApproval: async () => true };
    expect(resolveApprovalPort({} as never, undefined, port)).toBe(port);
    expect(resolveApprovalPort({} as never)).toBeUndefined();
  });
});
