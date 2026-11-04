// From repository root: node --expose-gc --conditions=development --import tsx packages/im/agent/tests/benchmarks/reply-parser.ts
import { performance } from 'node:perf_hooks';
import { createStructuredReplyStreamParser } from '../../src/outbound/structured-reply-stream.js';
import { createLegacyStructuredReplyStreamParser } from '../core/structured-reply-stream-baseline.js';

interface Measurement {
  elapsedMs: number;
  startHeapBytes: number;
  peakSampledHeapBytes: number;
  retainedHeapBytes: number;
  finalCharacters: number;
  cumulativeCharacters: number;
}
interface Scenario { name: string; deltas: readonly string[] }
const gc = (globalThis as { gc?: () => void }).gc;
const profile = { types: ['text', 'face'] as const, reaction: { values: [{ value: 'ok', label: 'OK' }] } };
const scenarios: Scenario[] = [];
for (const count of [300, 1200]) {
  for (const name of ['non-json', 'withheld-reaction', 'visible-text', 'numeric-field', 'SDK-compatibility']) {
    const header = name === 'non-json' ? 'ordinary prose ' : name === 'numeric-field'
      ? '{"reaction":"","messages":[{"segments":[{"type":"face","data":{"id":1.5e+1}},{"type":"text","data":{"text":"' :
      `{"${name === 'SDK-compatibility' ? '\\u0072eaction' : 'reaction'}":"${name === 'withheld-reaction' ? 'ok' : ''}","messages":[{"segments":[{"type":"text","data":{"text":"`;
    scenarios.push({ name, deltas: Array.from({ length: count }, (_, index) => (index ? '' : header) + 'x'.repeat(64)) });
  }
}
for (const size of [1024, 65536, 1048576]) {
  scenarios.push({ name: `single-chunk-${size}`, deltas: [
    '{"reaction":"","messages":[{"segments":[{"type":"text","data":{"text":"' + 'x'.repeat(size),
  ] });
}

const rows: { scenario: string; deltas: number; variant: string; measurements: Measurement[] }[] = [];
for (const scenario of scenarios) {
  for (const variant of ['legacy', 'incremental'] as const) {
    const measurements: Measurement[] = [];
    for (let round = 0; round < 4; round++) {
      gc?.();
      const startHeap = process.memoryUsage().heapUsed;
      let peakHeap = startHeap, raw = '', cumulativeCharacters = 0;
      const start = performance.now();
      const old = variant === 'legacy' ? createLegacyStructuredReplyStreamParser(profile) : undefined;
      const current = variant === 'incremental' ? createStructuredReplyStreamParser(profile) : undefined;
      for (const [index, delta] of scenario.deltas.entries()) {
        raw += delta;
        cumulativeCharacters += raw.length;
        if (old) await old.parse(raw, index + 1);
        else { current!.append(delta); await current!.snapshot(index + 1); }
        if (index % 100 === 0 || index === scenario.deltas.length - 1) {
          peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
        }
      }
      const elapsedMs = performance.now() - start;
      gc?.();
      if (round) measurements.push({ elapsedMs: Math.round(elapsedMs * 100) / 100, startHeapBytes: startHeap,
        peakSampledHeapBytes: peakHeap, retainedHeapBytes: process.memoryUsage().heapUsed,
        finalCharacters: raw.length, cumulativeCharacters });
    }
    rows.push({ scenario: scenario.name, deltas: scenario.deltas.length, variant, measurements });
  }
}
console.log(JSON.stringify({
  note: 'Local synthetic parser-only comparison; first round discarded, GC outside timings. Sampled heap is process-level/noisy, not a production memory bound. SDK-compatibility intentionally retains fallback. No provider/platform requests.',
  rows,
}, null, 2));
