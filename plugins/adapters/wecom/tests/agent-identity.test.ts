import { describe, expect, it } from 'vitest';
import { resolveWecomConfig } from '../src/protocol.js';

describe('WeCom application identity', () => {
  it('requires agentId instead of treating agentSecret as an application identity', () => {
    expect(() => resolveWecomConfig({
      id: 'missing-agent', corpId: 'fixture-corporation', agentSecret: 'synthetic-secret',
      token: 'synthetic-token', encodingAESKey: Buffer.alloc(32, 7).toString('base64').replace(/=+$/, ''),
    })).toThrow('agentId');
  });
});
