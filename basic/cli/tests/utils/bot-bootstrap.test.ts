import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botInstructionsFile } from '../../src/utils/bot-bootstrap.js';

// #1250: the CLI names the same instruction file the runtime reads — only a non-empty root BOT.md counts.
describe('botInstructionsFile', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-cli-bot-md-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('defaults to BOT.md and keeps an existing AGENTS.md when the root has no BOT.md', () => {
    expect(botInstructionsFile(root)).toBe('BOT.md');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'memory');
    expect(botInstructionsFile(root)).toBe('AGENTS.md');
  });

  it('ignores data/BOT.md and an empty root BOT.md, like the runtime', () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'memory');
    fs.mkdirSync(path.join(root, 'data'));
    fs.writeFileSync(path.join(root, 'data', 'BOT.md'), 'data bot');
    expect(botInstructionsFile(root)).toBe('AGENTS.md');
    fs.writeFileSync(path.join(root, 'BOT.md'), '  \n');
    expect(botInstructionsFile(root)).toBe('AGENTS.md');
    fs.writeFileSync(path.join(root, 'BOT.md'), 'bot rules');
    expect(botInstructionsFile(root)).toBe('BOT.md');
  });
});
