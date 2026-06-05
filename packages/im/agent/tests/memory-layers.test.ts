import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  safeSessionKey,
  loadMemoryLayers,
  buildMemoryPrompt,
  checkMemoryWritePath,
  classifyMemoryWritePath,
  migrateLegacyMemoryFiles,
  resetMemoryMigrationForTests,
  getSessionMemoryDir,
} from '../src/memory-layers.js';

describe('memory-layers', () => {
  let tmpDir: string;

  beforeEach(() => {
    resetMemoryMigrationForTests();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-memory-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('safeSessionKey 稳定且不含冒号', () => {
    const key = 'icqq:bot1:private:user1';
    const a = safeSessionKey(key);
    const b = safeSessionKey(key);
    expect(a).toBe(b);
    expect(a).not.toContain(':');
  });

  it('loadMemoryLayers 读取 global / platform / session', () => {
    const globalDir = path.join(tmpDir, 'data', 'memory', 'global');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.writeFileSync(path.join(globalDir, 'MEMORY.md'), 'global fact');

    const platDir = path.join(tmpDir, 'data', 'memory', 'platforms', 'icqq');
    fs.mkdirSync(platDir, { recursive: true });
    fs.writeFileSync(path.join(platDir, 'RULES.md'), 'no spam');

    const sessionKey = 'icqq:bot1:private:u1';
    const sessDir = getSessionMemoryDir(sessionKey, tmpDir);
    fs.mkdirSync(sessDir, { recursive: true });
    fs.writeFileSync(path.join(sessDir, 'MEMORY.md'), 'likes cats');

    const layers = loadMemoryLayers({
      workspaceDir: tmpDir,
      platform: 'icqq',
      sessionKey,
    });
    expect(layers.slices.some(s => s.key === 'global')).toBe(true);
    expect(layers.slices.some(s => s.key === 'platform')).toBe(true);
    expect(layers.slices.some(s => s.key === 'session')).toBe(true);
  });

  it('buildMemoryPrompt 超预算时先裁 daily', () => {
    const layers = loadMemoryLayers({
      workspaceDir: tmpDir,
      platform: 'x',
      sessionKey: 'a:b:private:1',
    });
    layers.slices.push(
      { key: 'daily', title: "Today's Notes", content: 'd'.repeat(500), chars: 500 },
      { key: 'global', title: 'Global', content: 'g'.repeat(500), chars: 500 },
      { key: 'platform', title: 'Platform x', content: 'p'.repeat(500), chars: 500 },
      { key: 'session', title: 'Session', content: 's'.repeat(500), chars: 500 },
    );
    const out = buildMemoryPrompt(layers, { session: 200, platform: 200, global: 200, daily: 50 });
    expect(out).toContain('## Session');
    expect(out.length).toBeLessThan(2000);
  });

  it('migrateLegacyMemoryFiles 复制旧 MEMORY.md', () => {
    const memDir = path.join(tmpDir, 'data', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, 'MEMORY.md'), 'legacy content');
    migrateLegacyMemoryFiles(tmpDir);
    const globalFile = path.join(memDir, 'global', 'MEMORY.md');
    expect(fs.existsSync(globalFile)).toBe(true);
    expect(fs.readFileSync(globalFile, 'utf-8')).toBe('legacy content');
  });

  it('checkMemoryWritePath：global 仅 master', () => {
    const globalPath = path.join(tmpDir, 'data', 'memory', 'global', 'MEMORY.md');
    const sessionPath = path.join(
      tmpDir,
      'data',
      'memory',
      'sessions',
      safeSessionKey('icqq:b:private:u'),
      'MEMORY.md',
    );

    expect(classifyMemoryWritePath(globalPath, tmpDir)).toBe('global');
    expect(classifyMemoryWritePath(sessionPath, tmpDir)).toBe('session');

    const denied = checkMemoryWritePath(globalPath, {
      platform: 'icqq',
      botId: 'b',
      senderId: 'user1',
      roles: ['other'],
    } as never, tmpDir);
    expect(denied.allowed).toBe(false);

    const ok = checkMemoryWritePath(globalPath, {
      platform: 'icqq',
      botId: 'b',
      senderId: 'owner1',
      roles: ['master'],
    } as never, tmpDir);
    expect(ok.allowed).toBe(true);

    const sessionOk = checkMemoryWritePath(sessionPath, {
      senderId: 'user1',
      roles: ['other'],
    } as never, tmpDir);
    expect(sessionOk.allowed).toBe(true);
  });
});
