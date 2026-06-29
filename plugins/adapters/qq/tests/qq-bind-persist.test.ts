import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildQqCredentialEnvKeys,
  persistQqCredentialsToEnv,
} from '../src/qq-bind-persist.js';

describe('qq-bind-persist', () => {
  let tmp: string;
  let prevRoot: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-env-'));
    prevRoot = process.env.ZHIN_PROJECT_ROOT;
    process.env.ZHIN_PROJECT_ROOT = tmp;
  });

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ZHIN_PROJECT_ROOT;
    else process.env.ZHIN_PROJECT_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('buildQqCredentialEnvKeys uses endpoint name slug', () => {
    expect(buildQqCredentialEnvKeys('mock-qq-bot')).toEqual({
      appidKey: 'QQ_MOCK_QQ_BOT_APPID',
      secretKey: 'QQ_MOCK_QQ_BOT_SECRET',
      appidRef: '${QQ_MOCK_QQ_BOT_APPID}',
      secretRef: '${QQ_MOCK_QQ_BOT_SECRET}',
    });
  });

  it('persistQqCredentialsToEnv writes .env and process.env', () => {
    const keys = persistQqCredentialsToEnv('mybot', 'app-1', 'sec-1');
    const envPath = path.join(tmp, '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toMatch(new RegExp(`^${keys.appidKey}=app-1$`, 'm'));
    expect(content).toMatch(new RegExp(`^${keys.secretKey}=sec-1$`, 'm'));
    expect(process.env[keys.appidKey]).toBe('app-1');
    expect(process.env[keys.secretKey]).toBe('sec-1');

    persistQqCredentialsToEnv('mybot', 'app-2', 'sec-2');
    const updated = fs.readFileSync(envPath, 'utf-8');
    expect(updated.match(new RegExp(`^${keys.appidKey}=`, 'gm'))).toHaveLength(1);
    expect(updated).toMatch(new RegExp(`^${keys.appidKey}=app-2$`, 'm'));
    expect(updated).toMatch(new RegExp(`^${keys.secretKey}=sec-2$`, 'm'));
  });

  it('persistQqCredentialsToEnv appends each key on its own line to existing .env', () => {
    const envPath = path.join(tmp, '.env');
    fs.writeFileSync(envPath, 'AI_SDK_LOG_WARNINGS=false\n');
    const keys = persistQqCredentialsToEnv('mock-bot', '900000001', 'mock-secret');
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toEqual([
      'AI_SDK_LOG_WARNINGS=false',
      `${keys.appidKey}=900000001`,
      `${keys.secretKey}=mock-secret`,
    ]);
  });
});
