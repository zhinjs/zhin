/**
 * Eval → trace link (#728 M1.5): a failing case's per-turn traces are written
 * to a trace archive directory, and the report says how to open each one with
 * `zhin trace` (or the Console Agent Trace page when the directory is a
 * project's `data/agent-traces`).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTurnTraceArchive } from '../../src/trace/turn-trace-archive.js';
import type { EvalRunRecord } from './driver.js';

/** `ZHIN_EVAL_TRACE_DIR`, or a stable directory under the OS temp dir. */
export function evalTraceDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.ZHIN_EVAL_TRACE_DIR?.trim() || join(tmpdir(), 'zhin-eval-traces');
}

/** Persist the run's traces and return one "open it" line per turn. */
export async function persistEvalTraces(run: EvalRunRecord, dir = evalTraceDir()): Promise<string[]> {
  if (run.traces.length === 0) return [];
  const archive = createTurnTraceArchive(dir, { secrets: [] });
  for (const trace of run.traces) await archive.save(trace);
  return run.traces.map((trace) => `zhin trace ${trace.turn_id} --dir ${JSON.stringify(dir)}  (Console: /console/agent-trace?turn=${encodeURIComponent(trace.turn_id)})`);
}
