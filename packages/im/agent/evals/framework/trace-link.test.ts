import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTurnTraceArchive } from '../../src/trace/turn-trace-archive.js';
import { defineEvalCase, evaluateExpectations, formatEvalReport, persistEvalTraces, runEvalCase } from './index.js';

describe('eval failure → trace link (#728)', () => {
  it('persists a failing run\'s traces and the report says how to open them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eval-trace-link-'));
    try {
      const definition = defineEvalCase({
        id: 'trace-link-demo', description: 'deliberately failing', source: 'test',
        inbound: { text: 'hi' }, script: [{ text: 'hello' }], expect: { outboundContains: ['never said'] },
      });
      const run = await runEvalCase(definition);
      const failures = evaluateExpectations(definition, run);
      expect(failures.length).toBeGreaterThan(0);
      const links = await persistEvalTraces(run, dir);
      const turnId = run.traces[0]!.turn_id;
      expect(links).toEqual([expect.stringContaining(`zhin trace ${turnId} --dir`)]);
      expect(formatEvalReport(definition, run, failures, links)).toContain(`↪ zhin trace ${turnId}`);
      expect((await createTurnTraceArchive(dir, { secrets: [] }).find(turnId))?.session_key).toBe(run.traces[0]!.session_key);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
