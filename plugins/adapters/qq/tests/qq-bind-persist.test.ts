import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildQqCredentialEnvKeys,
  persistQqCredentialsToEnv,
} from '../src/qq-bind-persist.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bind-persist-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.QQ_MY_BOT_APPID;
  delete process.env.QQ_MY_BOT_SECRET;
});

describe('buildQqCredentialEnvKeys', () => {
  it('非法字符转下划线并大写', () => {
    expect(buildQqCredentialEnvKeys('my-bot')).toEqual({
      appidKey: 'QQ_MY_BOT_APPID',
      secretKey: 'QQ_MY_BOT_SECRET',
      appidRef: '${QQ_MY_BOT_APPID}',
      secretRef: '${QQ_MY_BOT_SECRET}',
    });
  });
});

describe('persistQqCredentialsToEnv', () => {
  it('.env 不存在时创建并写入两个键，同步 process.env', () => {
    const keys = persistQqCredentialsToEnv('my-bot', 'app-1', 'sec-1', root);

    const content = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    expect(content).toBe('QQ_MY_BOT_APPID=app-1\nQQ_MY_BOT_SECRET=sec-1\n');
    expect(process.env.QQ_MY_BOT_APPID).toBe('app-1');
    expect(process.env.QQ_MY_BOT_SECRET).toBe('sec-1');
    expect(keys.appidRef).toBe('${QQ_MY_BOT_APPID}');
  });

  it('已有键时更新而不是追加，保留其它行', () => {
    fs.writeFileSync(
      path.join(root, '.env'),
      'OTHER=keep\nQQ_MY_BOT_APPID=old\n',
    );

    persistQqCredentialsToEnv('my-bot', 'app-2', 'sec-2', root);

    const content = fs.readFileSync(path.join(root, '.env'), 'utf-8');
    expect(content).toBe('OTHER=keep\nQQ_MY_BOT_APPID=app-2\nQQ_MY_BOT_SECRET=sec-2\n');
  });
});
