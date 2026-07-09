import { describe, it, expect } from 'vitest';
import { normalizePlannerOutboundBatches } from '../../src/collaboration/outbound-resolver.js';
import type { CollaborationScene } from '../../src/collaboration/types.js';

const cell: CollaborationScene = {
  id: 'room',
  adapter: 'icqq',
  sceneId: '373460458',
  members: [
    { endpointId: '8596238', primary: 'planner', pipelineRole: 'planner' },
    { endpointId: '210723495', primary: 'researcher', pipelineRole: 'researcher' },
    { endpointId: '1689919782', primary: 'evaluator', pipelineRole: 'evaluator' },
  ],
};

const adapter = {
  endpoints: new Map([
    ['8596238', { $platformUserId: '8596238' }],
    ['210723495', { $platformUserId: '210723495' }],
    ['1689919782', { $platformUserId: '1689919782' }],
  ]),
};

describe('normalizePlannerOutboundBatches', () => {
  it('keeps single-batch real @ delegate (not stripped empty)', () => {
    const batches = normalizePlannerOutboundBatches(
      [[
        { type: 'at', data: { id: '1689919782', qq: '1689919782' } },
        { type: 'text', data: { text: ' 请评估' } },
      ]],
      cell,
      '8596238',
      adapter as never,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]![0]).toMatchObject({ type: 'at' });
  });

  it('splits plain @evaluator text into prose + delegate batch', () => {
    const batches = normalizePlannerOutboundBatches(
      [[{ type: 'text', data: { text: ' @1689919782 请基于此进行评估分析。' } }]],
      cell,
      '8596238',
      adapter as never,
    );
    expect(batches).toHaveLength(2);
    expect(batches[1]![0]).toMatchObject({ type: 'at', data: { id: '1689919782' } });
  });

  it('splits **Evaluator**,请 prose into delegate batch (log case)', () => {
    const batches = normalizePlannerOutboundBatches(
      [[{
        type: 'text',
        data: {
          text: ' 好的，Researcher 的完整调研报告已在群内发出。**Evaluator**，请直接基于群内报告进行评估分析，我在等你的评估结果！',
        },
      }]],
      cell,
      '8596238',
      adapter as never,
    );
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(batches.some((b) => b.some((s) => s.type === 'at'))).toBe(true);
    const atBatch = batches.find((b) => b.some((s) => s.type === 'at'));
    expect(atBatch?.[0]).toMatchObject({ type: 'at', data: { id: '1689919782' } });
  });
});
