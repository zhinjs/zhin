import { describe, expect, it } from 'vitest';
import { isHeartbeatEmpty } from '../src/index.js';

describe('isHeartbeatEmpty', () => {
  it('treats missing, blank, heading-only and empty-checkbox content as empty', () => {
    expect(isHeartbeatEmpty(null)).toBe(true);
    expect(isHeartbeatEmpty('')).toBe(true);
    expect(isHeartbeatEmpty('# Heartbeat\n\n<!-- note -->\n- [ ]\n* [x]\n')).toBe(true);
  });

  it('reports any actionable line', () => {
    expect(isHeartbeatEmpty('# Heartbeat\n- [ ] water the plants\n')).toBe(false);
    expect(isHeartbeatEmpty('check the build')).toBe(false);
  });
});
