import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  formatDisplayPath,
  shortenPathsInText,
  looksLikeAbsolutePath,
  isPathLikeField,
} from '../src/display-path.js';

describe('formatDisplayPath', () => {
  const projectRoot = path.resolve('/tmp/zhin-display-root');
  const homeDir = path.resolve('/tmp/zhin-display-home');

  it('shortens paths under project root to ./relative', () => {
    const abs = path.join(projectRoot, 'packages', 'ai', 'src', 'index.ts');
    expect(formatDisplayPath(abs, { projectRoot, homeDir })).toBe('./packages/ai/src/index.ts');
  });

  it('returns . for project root itself', () => {
    expect(formatDisplayPath(projectRoot, { projectRoot, homeDir })).toBe('.');
  });

  it('preferHome shows ~/ path when dir equals project root under home', () => {
    const project = path.join(homeDir, 'IdeaProjects', 'zhin', 'examples', 'test-bot');
    expect(formatDisplayPath(project, { projectRoot: project, homeDir, preferHome: true })).toBe(
      '~/IdeaProjects/zhin/examples/test-bot',
    );
  });

  it('shortens paths under home to ~/relative when outside project', () => {
    const outside = path.join(homeDir, 'IdeaProjects', 'zhin', 'zhin.config.yml');
    expect(formatDisplayPath(outside, { projectRoot, homeDir })).toBe(
      '~/IdeaProjects/zhin/zhin.config.yml',
    );
  });

  it('returns ~ for home itself', () => {
    expect(formatDisplayPath(homeDir, { projectRoot, homeDir })).toBe('~');
  });

  it('keeps paths outside project and home as-is', () => {
    const outside = '/var/log/syslog';
    expect(formatDisplayPath(outside, { projectRoot, homeDir })).toBe(outside);
  });

  it('does not shorten http(s) URLs', () => {
    const url = 'https://example.com/foo/bar';
    expect(formatDisplayPath(url, { projectRoot, homeDir })).toBe(url);
  });

  it('shortens file:// URLs under project root', () => {
    const abs = path.join(projectRoot, 'README.md');
    const fileUrl = `file://${abs}`;
    expect(formatDisplayPath(fileUrl, { projectRoot, homeDir })).toBe('file://./README.md');
  });
});

describe('shortenPathsInText', () => {
  const projectRoot = path.resolve('/tmp/zhin-text-root');

  it('replaces project-root prefixes in prose', () => {
    const file = path.join(projectRoot, 'README.md');
    const input = `read ${file} and ${projectRoot}`;
    const out = shortenPathsInText(input, { projectRoot, homeDir: '/tmp/unused-home' });
    expect(out).toBe('read ./README.md and .');
  });

  it('replaces file:// URLs in text', () => {
    const file = path.join(projectRoot, 'a.ts');
    const input = `see file://${file}?t=1`;
    const out = shortenPathsInText(input, { projectRoot, homeDir: '/tmp/unused-home' });
    expect(out).toContain('file://./a.ts');
    expect(out).not.toContain(projectRoot);
  });
});

describe('path heuristics', () => {
  it('isPathLikeField matches path-like keys', () => {
    expect(isPathLikeField('configPath')).toBe(true);
    expect(isPathLikeField('log_file')).toBe(true);
    expect(isPathLikeField('status')).toBe(false);
  });

  it('looksLikeAbsolutePath detects fs paths not http', () => {
    expect(looksLikeAbsolutePath('/Users/foo/bar')).toBe(true);
    expect(looksLikeAbsolutePath('file:///tmp/x')).toBe(true);
    expect(looksLikeAbsolutePath('https://x.com/y')).toBe(false);
    expect(looksLikeAbsolutePath('hello')).toBe(false);
  });
});
