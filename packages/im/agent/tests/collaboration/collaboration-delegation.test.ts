import { describe, it, expect } from 'vitest';
import {
  isCellToolResultJson,
  removeEmbeddedCellToolJsonFromText,
  summarizeDelegateeReply,
} from '../../src/collaboration/collaboration-delegation.js';

describe('collaboration-delegation outbound hygiene', () => {
  it('isCellToolResultJson detects cell_pipeline_status dumps', () => {
    const raw = JSON.stringify({
      ok: true,
      collaborationSceneId: 'icqq-collab-room',
      pipelineState: { runId: 'f084a265', stage: 'researcher' },
    });
    expect(isCellToolResultJson(raw)).toBe(true);
  });

  it('isCellToolResultJson detects cell_submit_artifact dumps', () => {
    const raw = JSON.stringify({
      ok: true,
      kind: 'report',
      runId: 'f084a265',
      activeRunId: 'f084a265',
    });
    expect(isCellToolResultJson(raw)).toBe(true);
  });

  it('removeEmbeddedCellToolJsonFromText keeps prose around tool JSON', () => {
    const blob = JSON.stringify({ ok: true, kind: 'report', runId: 'r1' });
    const mixed = `调研完成。${blob} 详见上文。`;
    expect(removeEmbeddedCellToolJsonFromText(mixed)).toBe('调研完成。 详见上文。');
  });

  it('summarizeDelegateeReply drops tool JSON blobs', () => {
    const raw = JSON.stringify({ ok: true, collaborationSceneId: 'c1', runs: [] });
    expect(summarizeDelegateeReply(raw)).toBe('已完成。');
    expect(summarizeDelegateeReply('调研完成，已写入 report。')).toContain('调研完成');
  });

  it('removeEmbeddedCellToolJsonFromText drops fenced cell tool JSON', () => {
    const json = JSON.stringify({ ok: true, collaborationSceneId: 'sc-1' });
    const mixed = `前言。\n\`\`\`json\n${json}\n\`\`\`\n后文。`;
    expect(removeEmbeddedCellToolJsonFromText(mixed)).toBe('前言。 后文。');
  });

  it('removeEmbeddedCellToolJsonFromText keeps non-cell fenced blocks verbatim', () => {
    const mixed = '看这里 ```json {"a":1}``` 完毕';
    expect(removeEmbeddedCellToolJsonFromText(mixed)).toBe('看这里 ```json {"a":1}``` 完毕');
  });

  it('removeEmbeddedCellToolJsonFromText handles 100k chars after unclosed fence in linear time', () => {
    const input = `\`\`\`json\n${'x'.repeat(100_000)}`;
    const start = performance.now();
    const result = removeEmbeddedCellToolJsonFromText(input);
    expect(performance.now() - start).toBeLessThan(100);
    expect(result).toContain('xxx');
  });

  it('summarizeDelegateeReply strips fenced blocks with 100k adversarial fences in linear time', () => {
    const input = '```a'.repeat(25_000);
    const start = performance.now();
    summarizeDelegateeReply(input);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
