import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveWorkspacePrompt,
  clearWorkspacePromptCache,
} from '../../src/zhin-agent/workspace-prompt.js';

describe('workspace-prompt', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-ws-prompt-'));
    clearWorkspacePromptCache();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearWorkspacePromptCache();
  });

  it('包内 fallback 可加载 orchestrator', () => {
    const text = resolveWorkspacePrompt('orchestrator', undefined, tmpDir);
    expect(text).toContain('# Orchestration');
    expect(text).toContain('run_deferred_task');
  });

  it('workspace 覆盖通用文件', () => {
    const promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'orchestrator.md'), '# Orchestration\n\n - custom base');
    const text = resolveWorkspacePrompt('orchestrator', undefined, tmpDir);
    expect(text).toContain('custom base');
  });

  it('sdk 片段追加到通用段', () => {
    const promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'orchestrator.md'), 'base part');
    fs.writeFileSync(path.join(promptsDir, 'orchestrator.anthropic.md'), 'anthropic part');
    const text = resolveWorkspacePrompt('orchestrator', 'anthropic', tmpDir);
    expect(text).toContain('base part');
    expect(text).toContain('anthropic part');
  });

  it('缺 sdk 文件时 fallback 到通用', () => {
    const promptsDir = path.join(tmpDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'deferred-worker.md'), 'worker only');
    const text = resolveWorkspacePrompt('deferred-worker', 'openai', tmpDir);
    expect(text).toBe('worker only');
  });
});
