import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  packageSubagentResult,
  SUBAGENT_ARTIFACT_THRESHOLD,
  writeSubagentArtifact,
} from '../src/subagent-artifact.js';

describe('subagent-artifact', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-artifact-'));
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(path.dirname(cwd));
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('短结果不写 artifact', () => {
    const { text, artifactPath } = packageSubagentResult('ok', 'abc12345', 100);
    expect(text).toBe('ok');
    expect(artifactPath).toBeUndefined();
  });

  it('超长结果落盘并返回路径', () => {
    const long = 'x'.repeat(SUBAGENT_ARTIFACT_THRESHOLD + 1);
    const { text, artifactPath } = packageSubagentResult(long, 'deadbeef');
    expect(artifactPath).toBeTruthy();
    expect(fs.existsSync(artifactPath!)).toBe(true);
    expect(text).toContain('artifact:');
    expect(fs.readFileSync(artifactPath!, 'utf-8')).toBe(long);
  });

  it('writeSubagentArtifact 写入 data/artifacts/subagent', () => {
    const p = writeSubagentArtifact('task1', '# report');
    expect(p).toContain(path.join('data', 'artifacts', 'subagent', 'task1.md'));
    expect(fs.readFileSync(p, 'utf-8')).toBe('# report');
  });
});
