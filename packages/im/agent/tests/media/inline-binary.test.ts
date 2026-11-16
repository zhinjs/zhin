import { describe, expect, it } from 'vitest';
import {
  FILE_TOOL_TRUNCATE_CHARS,
  INLINE_BINARY_MIN_CHARS,
  containsInlineBinaryPlaceholder,
  omitInlineBinaryForModel,
  omitInlineBinaryInCompletions,
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
    const adversarial = (bytes: number) =>
      Array.from({ length: Math.ceil(bytes / INLINE_BINARY_MIN_CHARS) }, () => segment).join(' ');
    const text = adversarial(1_048_576);
    expect(omitInlineBinaryForModel(text)).toBe(text);
    const plain = 'a'.repeat(4 * 1_048_576);
    expect(omitInlineBinaryForModel(plain)).toBe('[已省略 base64 数据（4194304 字符），未提供给模型]');

    // Two guards, each measured as the best of three runs of one input:
    // - growth: a super-linear scan grows ~16× when the input grows 4×;
    // - a ceiling for the regex this replaced, which backtracked over every
    //   2047-character run and took ~2.7 s for 1 MiB. The ceiling leaves room for
    //   coverage instrumentation on slow CI runners (the old 500 ms budget for
    //   both inputs together did not).
    const fastest = (input: string) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i += 1) {
        const started = performance.now();
        omitInlineBinaryForModel(input);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const small = fastest(adversarial(262_144));
    const large = fastest(adversarial(1_048_576));
    expect(large / Math.max(small, 0.5)).toBeLessThan(8);
    expect(large).toBeLessThan(1500);
  });

  it('recognises only its own placeholders', () => {
    expect(containsInlineBinaryPlaceholder('已省略部分内容')).toBe(false);
    expect(containsInlineBinaryPlaceholder('[已省略 3 行]')).toBe(false);
    expect(containsInlineBinaryPlaceholder('[已省略 base64 数据（12 字符），未提供给模型]')).toBe(true);
  });
});

describe('omitInlineBinaryInCompletions (#1250 batch 29 review)', () => {
  it('strips inline binary from user and assistant text before an internal completion (compaction summaries)', async () => {
    const payload = run(4000);
    const seen: string[] = [];
    const reply = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } as never;
    const port = omitInlineBinaryInCompletions({
      complete: async (_model, context) => { seen.push(JSON.stringify(context.messages)); return reply; },
      completeSimple: async (_model, context) => { seen.push(JSON.stringify(context.messages)); return reply; },
    });
    const context = { systemPrompt: '', messages: [
      { role: 'user', content: `New conversation:\n[Assistant] data:audio/mpeg;base64,${payload}`, timestamp: 0 },
      { role: 'user', content: [{ type: 'text', text: payload }], timestamp: 0 },
      { role: 'assistant', content: [{ type: 'text', text: payload }] },
    ] } as never;
    await port.completeSimple({} as never, context);
    await port.complete({} as never, context);
    expect(seen).toHaveLength(2);
    for (const request of seen) {
      expect(request).not.toContain(payload.slice(0, 64));
      expect(request).toContain('[已省略 内嵌 audio/mpeg 数据（4000 字符），未提供给模型]');
    }
  });
});

describe('stripFrameworkPlaceholders (#1250 batch 29 review)', () => {
  it('removes only the framework placeholder shapes', async () => {
    const { stripFrameworkPlaceholders, stripFrameworkPlaceholdersInStream, stripFrameworkPlaceholdersInOutput } = await import('../../src/media/inline-binary.js');
    expect(stripFrameworkPlaceholders('a[已省略 base64 数据（4000 字符），未提供给模型]b')).toBe('ab');
    expect(stripFrameworkPlaceholders('a[已截断 内嵌 image/png 数据（70000 字符），未提供给模型；原文仍完整保留，不要把这段写回文件]b')).toBe('ab');
    expect(stripFrameworkPlaceholders('a[语音 mp3 18.6KB 已发送][语音 2.9KB 已发送][图片 image/png 3.1KB 已发送]b')).toBe('ab');
    expect(stripFrameworkPlaceholders('a[语音（内嵌数据，已省略）][文件: a.pdf（内嵌数据，已省略）][图片: 生成的图片（image/png 3.1KB）]b')).toBe('ab');
    for (const ordinary of ['[注意] 已发送', '[语音] 我发了', '[图片: 一只猫]', '[已省略部分]', '数组 [1, 2]', '[语音消息 已发送了吗]']) {
      expect(stripFrameworkPlaceholders(ordinary)).toBe(ordinary);
    }
    // Streaming holds back an unfinished tail that could still become a placeholder.
    expect(stripFrameworkPlaceholdersInStream('好的[语音 mp3 18', false)).toBe('好的');
    expect(stripFrameworkPlaceholdersInStream('好的[已', false)).toBe('好的');
    expect(stripFrameworkPlaceholdersInStream('好的[注', false)).toBe('好的[注');
    expect(stripFrameworkPlaceholdersInStream('好的[语音 mp3 18', true)).toBe('好的[语音 mp3 18');
    // Output: blank segments and messages left behind are dropped.
    expect(stripFrameworkPlaceholdersInOutput([
      { type: 'message', segments: [{ type: 'text', data: { text: '[语音 mp3 18.6KB 已发送]' } }] },
      { type: 'message', segments: [{ type: 'text', data: { text: '还在 [语音 已发送]' } }, { type: 'markdown', data: { content: ' [已省略 base64 数据（9 字符），未提供给模型] ' } }] },
      { type: 'text', content: '[语音（内嵌数据，已省略）]' },
    ] as never)).toEqual([{ type: 'message', segments: [{ type: 'text', data: { text: '还在 ' } }] }]);
  });
});
