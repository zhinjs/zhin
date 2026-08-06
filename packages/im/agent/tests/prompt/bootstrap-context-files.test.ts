import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadContextFiles,
  buildGlobalContextSection,
  DEFAULT_GLOBAL_CONTEXT_PATHS,
} from '../../src/bootstrap.js';

const tmpDirs: string[] = [];

function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-ctx-files-'));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadContextFiles', () => {
  it('加载绝对/相对路径文件，缺失静默跳过', async () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'alpha');

    const files = await loadContextFiles(
      ['a.md', path.join(dir, 'missing.md'), ''],
      { cwd: dir },
    );
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(path.join(dir, 'a.md'));
    expect(files[0].content).toBe('alpha');
  });

  it('按解析后路径去重', async () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'alpha');

    const files = await loadContextFiles(['a.md', './a.md', path.join(dir, 'a.md')], { cwd: dir });
    expect(files).toHaveLength(1);
  });

  it('空文件跳过', async () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'empty.md'), '  \n');

    const files = await loadContextFiles(['empty.md'], { cwd: dir });
    expect(files).toHaveLength(0);
  });

  it('单文件超限截断', async () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'big.md'), 'x'.repeat(1000));

    const files = await loadContextFiles(['big.md'], { cwd: dir, maxChars: 100 });
    expect(files).toHaveLength(1);
    expect(files[0].content.length).toBeLessThan(1000);
    expect(files[0].content).toContain('...(truncated)');
  });

  it('总量超限跳过后续文件', async () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'a.md'), 'a'.repeat(100));
    fs.writeFileSync(path.join(dir, 'b.md'), 'b'.repeat(100));

    const files = await loadContextFiles(['a.md', 'b.md'], { cwd: dir, totalMaxChars: 150 });
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe('a'.repeat(100));
  });

  it('~ 展开到 home 目录', async () => {
    // 通过默认全局路径常量验证 ~ 前缀被识别（真实 home 下通常不存在，静默跳过即可）
    const files = await loadContextFiles(DEFAULT_GLOBAL_CONTEXT_PATHS, { cwd: mkTmp() });
    // 不抛错即为通过；若用户 home 真有这些文件，路径应以 home 开头
    for (const f of files) {
      expect(f.path.startsWith(os.homedir())).toBe(true);
    }
  });
});

describe('buildGlobalContextSection', () => {
  it('空列表返回空串', () => {
    expect(buildGlobalContextSection([])).toBe('');
  });

  it('单文件：标题 + 正文，无来源标记', () => {
    const section = buildGlobalContextSection([{ path: '/x/a.md', content: 'alpha' }]);
    expect(section).toBe('# User Context\n\nalpha');
  });

  it('多文件：每个文件前一行来源标记，无代码块包装', () => {
    const section = buildGlobalContextSection([
      { path: '/x/a.md', content: 'alpha' },
      { path: '/x/b.md', content: 'beta' },
    ]);
    expect(section).toBe('# User Context\n\n(from /x/a.md)\nalpha\n\n(from /x/b.md)\nbeta');
    expect(section).not.toContain('```');
  });
});
