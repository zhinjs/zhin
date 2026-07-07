import { describe, expect, it } from 'vitest';
import { segmentsForAgentPanel, segmentsForImDelivery } from '../client/segments.js';

describe('console segmentsForImDelivery', () => {
  it('inbox view strips AI-only segments', () => {
    const full = [
      { type: 'thinking', data: { text: 'plan' } },
      { type: 'text', data: { text: 'hi' } },
      { type: 'tool_call', data: { name: 'bash' } },
    ];
    expect(segmentsForImDelivery(full)).toEqual([
      { type: 'text', data: { text: 'hi' } },
    ]);
    expect(segmentsForAgentPanel(full)).toEqual(full);
  });
});
