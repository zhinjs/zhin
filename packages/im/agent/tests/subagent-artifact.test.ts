import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  packageSubagentResult,
  SUBAGENT_ARTIFACT_THRESHOLD,
  writeSubagentArtifact,
} from '../src/subagent-artifact.js';
import { formatTaskFailure } from '../src/core/agent-run-shared.js';

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

  it('keeps a failure reason visible in the existing artifact preview even when it also appears at the body tail', () => {
    const reason = 'Necessary failure reason';
    const body = `Observed partial output ${'.'.repeat(SUBAGENT_ARTIFACT_THRESHOLD)} ${reason}`;
    const formatted = formatTaskFailure({ content: body, errorMessage: reason });
    const result = packageSubagentResult(formatted, 'error-tail');
    expect(result.text).toContain(reason);
    expect(result.text).toContain('Observed partial output');
    expect(fs.readFileSync(result.artifactPath!, 'utf8')).toContain(body);
  });

  it.each(['Necessary failure reason', 'Error: Necessary failure reason\n\nObserved partial output'])(
    'does not repeat a failure reason already visible at the beginning: %s', content => {
      expect(formatTaskFailure({ content, errorMessage: 'Necessary failure reason' })).toBe(content);
    },
  );
});
