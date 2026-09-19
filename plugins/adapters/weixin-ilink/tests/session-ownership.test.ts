import { IlinkSessionGuard } from '../src/ilink-session-guard.js';
import { WeixinContextTokenStore } from '../src/context-store.js';

describe('weixin-ilink endpoint-owned session state', () => {
  it('isolates cooldowns between endpoint instances', () => {
    let now = 1_000;
    const left = new IlinkSessionGuard('shared-account', () => now, 500);
    const right = new IlinkSessionGuard('shared-account', () => now, 500);

    left.pause();
    expect(left.paused).toBe(true);
    expect(right.paused).toBe(false);

    now += 500;
    expect(left.paused).toBe(false);
  });

  it('isolates context tokens between endpoint instances with the same account id', () => {
    const left = new WeixinContextTokenStore('shared-account');
    const right = new WeixinContextTokenStore('shared-account');

    left.set('user', 'left-token');
    expect(left.get('user')).toBe('left-token');
    expect(right.get('user')).toBeUndefined();

    left.clear();
    right.clear();
  });
});
