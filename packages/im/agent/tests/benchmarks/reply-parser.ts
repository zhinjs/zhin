// From repository root: node --expose-gc --conditions=development --import tsx packages/im/agent/tests/benchmarks/reply-parser.ts
import { performance } from 'node:perf_hooks';
import { createStructuredReplyStreamParser } from '../../src/outbound/structured-reply-stream.js';
import { createLegacyStructuredReplyStreamParser } from '../core/structured-reply-stream-baseline.js';
const gc = (globalThis as { gc?: () => void }).gc;
interface Measurement { elapsedMs: number; startHeapBytes: number; peakSampledHeapBytes: number; retainedHeapBytes: number; finalCharacters: number; cumulativeCharacters: number }
const rows: { scenario: string; deltas: number; variant: string; measurements: Measurement[] }[] = [];
const profile = { types: ['text'] as const, reaction: { values: [{ value: 'ok', label: 'OK' }] } };
for (const count of [300, 1200]) for (const scenario of ['non-json', 'withheld-reaction', 'visible-text', 'SDK-compatibility'] as const) {
 const header = scenario === 'non-json' ? 'ordinary prose ' :
   `{"${scenario === 'SDK-compatibility' ? '\\u0072eaction' : 'reaction'}":"${scenario === 'withheld-reaction' ? 'ok' : ''}","messages":[{"segments":[{"type":"text","data":{"text":"`;
 for (const variant of ['legacy', 'incremental'] as const) {
  const measurements: Measurement[]=[];
  for (let round=0; round<4; round++) {
   gc?.();
   const startHeap=process.memoryUsage().heapUsed;
   let peakHeap=startHeap, raw=header, cumulativeCharacters=0;
   const old = createLegacyStructuredReplyStreamParser(profile), current=createStructuredReplyStreamParser(profile);
   current.append(header);
   const start=performance.now();
   for(let i=1;i<=count;i++) {
    const delta='x'.repeat(64); raw+=delta; cumulativeCharacters+=raw.length;
    if (variant==='legacy') await old.parse(raw,i);
    else {current.append(delta);await current.snapshot(i);}
    if(i%100===0) peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
   }
   const elapsedMs=performance.now()-start;
   gc?.();
   if(round) measurements.push({elapsedMs:Math.round(elapsedMs*100)/100,startHeapBytes:startHeap,peakSampledHeapBytes:peakHeap,retainedHeapBytes:process.memoryUsage().heapUsed,finalCharacters:raw.length,cumulativeCharacters});
  }
  rows.push({scenario,deltas:count,variant,measurements});
 }
}
const output={note:'Local synthetic parser-only comparison; 64 UTF-16 chars per delta, first round discarded, GC outside timings. Sampled heap is process-level/noisy, not a production memory bound. SDK-compatibility intentionally retains fallback. No provider/platform requests.',rows};
console.log(JSON.stringify(output, null, 2));
