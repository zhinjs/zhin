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
});
