import { describe, expect, it } from 'vitest';
import {
  FILE_TOOL_TRUNCATE_CHARS,
  INLINE_BINARY_MIN_CHARS,
  containsInlineBinaryPlaceholder,
  omitInlineBinaryForModel,
} from '../../src/media/inline-binary.js';

const run = (length: number, seed = 7) => Buffer.alloc(Math.ceil((length * 3) / 4), seed).toString('base64').slice(0, length);

describe('omitInlineBinaryForModel (#1250 batch 29)', () => {
  it('keeps short data URLs (icons in CSS / SVG) for every tool', () => {
    const icon = `url(data:image/png;base64,${run(800)})`;
    expect(omitInlineBinaryForModel(icon)).toBe(icon);
    expect(omitInlineBinaryForModel(`a ${run(INLINE_BINARY_MIN_CHARS - 1)} b`)).toBe(`a ${run(INLINE_BINARY_MIN_CHARS - 1)} b`);
  });

  it('replaces data URLs and bare runs of 2048+ characters for ordinary tools', () => {
    const payload = run(INLINE_BINARY_MIN_CHARS);
    const shown = omitInlineBinaryForModel(`{"a":"data:audio/mpeg;base64,${payload}","b":"${payload}=="}`, { toolName: 'card_preview' });
    expect(shown).toBe(`{"a":"[已省略 内嵌 audio/mpeg 数据（2048 字符），未提供给模型]","b":"[已省略 base64 数据（2050 字符），未提供给模型]"}`);
    expect(containsInlineBinaryPlaceholder(shown)).toBe(true);
  });

  it('never replaces file content below 64 KiB for file / exploration tools, and labels a cut', () => {
    const css = `body{background:url(data:image/png;base64,${run(40_000)})}`;
    for (const toolName of ['read_file', 'grep', 'bash', 'web_fetch']) {
      expect(omitInlineBinaryForModel(css, { toolName })).toBe(css);
    }
    const huge = `x data:image/png;base64,${run(FILE_TOOL_TRUNCATE_CHARS)} y`;
    const cut = omitInlineBinaryForModel(huge, { toolName: 'read_file' });
    expect(cut).toBe(`x [已截断 内嵌 image/png 数据（${FILE_TOOL_TRUNCATE_CHARS} 字符），未提供给模型；原文仍完整保留，不要把这段写回文件] y`);
    expect(containsInlineBinaryPlaceholder(cut)).toBe(true);
  });

  it('is linear on adversarial input (2047-character runs separated by spaces)', () => {
    const segment = run(INLINE_BINARY_MIN_CHARS - 1);
    const text = Array.from({ length: Math.ceil(1_048_576 / INLINE_BINARY_MIN_CHARS) }, () => segment).join(' ');
    const started = performance.now();
    expect(omitInlineBinaryForModel(text)).toBe(text);
    const plain = 'a'.repeat(4 * 1_048_576);
    expect(omitInlineBinaryForModel(plain)).toBe('[已省略 base64 数据（4194304 字符），未提供给模型]');
    // Quadratic matching took ~2.7 s for the first input alone.
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('recognises only its own placeholders', () => {
    expect(containsInlineBinaryPlaceholder('已省略部分内容')).toBe(false);
    expect(containsInlineBinaryPlaceholder('[已省略 3 行]')).toBe(false);
    expect(containsInlineBinaryPlaceholder('[已省略 base64 数据（12 字符），未提供给模型]')).toBe(true);
  });
});
