import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getGitStatusLine, clearGitStatusCache } from '../../src/prompt/git-context.js';

const tmpDirs: string[] = [];

function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-git-ctx-'));
  tmpDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('getGitStatusLine', () => {
  beforeEach(() => {
    clearGitStatusCache();
  });

  it('非 git 仓库返回 null', async () => {
    const dir = mkTmp();
    expect(await getGitStatusLine(dir)).toBeNull();
  });

  it('干净仓库返回分支 + clean', async () => {
    const dir = mkTmp();
    git(dir, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    git(dir, ['add', '.']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

    const line = await getGitStatusLine(dir);
    expect(line).toBe('Git: main | clean');
  });

  it('按状态聚合计数，不列文件名', async () => {
    const dir = mkTmp();
    git(dir, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'world');
    git(dir, ['add', '.']);
    git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init']);

    // 2 个修改 + 1 个未跟踪
    fs.writeFileSync(path.join(dir, 'a.txt'), 'changed');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'changed');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'new');

    const line = await getGitStatusLine(dir);
    expect(line).toBe('Git: main | 2M 1?');
    expect(line).not.toContain('a.txt');
  });

  it('结果写入缓存，重复调用一致', async () => {
    const dir = mkTmp();
    git(dir, ['init', '-b', 'main']);
    const first = await getGitStatusLine(dir);
    const second = await getGitStatusLine(dir);
    expect(second).toBe(first);
  });

  it('单行且不超过 256 字符', async () => {
    const dir = mkTmp();
    git(dir, ['init', '-b', 'main']);
    for (let i = 0; i < 50; i++) {
      fs.writeFileSync(path.join(dir, `file-${i}.txt`), 'x');
    }
    const line = await getGitStatusLine(dir);
    expect(line).not.toBeNull();
    expect(line).not.toContain('\n');
    expect(line!.length).toBeLessThanOrEqual(256);
  });
});
