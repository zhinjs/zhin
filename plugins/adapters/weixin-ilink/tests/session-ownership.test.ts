import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WeixinIlinkStateStore } from '../src/credentials.js';
import { IlinkSessionGuard } from '../src/ilink-session-guard.js';
import { WeixinContextTokenStore } from '../src/context-store.js';

describe('weixin-ilink endpoint-owned session state', () => {
  it('isolates every persisted state category by endpoint id', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-ilink-state-'));
    const left = new WeixinIlinkStateStore('left', root);
    const right = new WeixinIlinkStateStore('right', root);

    expect(left.credentialsPath()).not.toBe(right.credentialsPath());
    expect(left.syncBufPath()).not.toBe(right.syncBufPath());
    expect(left.contextTokensPath()).not.toBe(right.contextTokensPath());
    expect(left.mediaDirectory('inbound')).not.toBe(right.mediaDirectory('inbound'));

    fs.rmSync(root, { recursive: true, force: true });
  });

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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weixin-ilink-session-'));
    const left = new WeixinContextTokenStore(new WeixinIlinkStateStore('shared-account', root));
    const right = new WeixinContextTokenStore(new WeixinIlinkStateStore('shared-account', root));

    left.set('user', 'left-token');
    expect(left.get('user')).toBe('left-token');
    expect(right.get('user')).toBeUndefined();

    left.clear();
    right.clear();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
