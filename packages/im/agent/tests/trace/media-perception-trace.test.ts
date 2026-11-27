import { describe, expect, it } from 'vitest';
import { TurnTraceCollector, formatTurnTrace, MEDIA_DESCRIPTION_TRACE_LENGTH } from '../../src/trace/index.js';
import { formatTurnUsageLogs } from '../../src/trace/turn-usage-log.js';

/** #1250 trace-media-perception-provenance-clipped */
describe('perception pre-pass in the turn trace', () => {
  const provenance = { source: 'media_perception' as const, provider: 'services:vision-backup', model: 'gemini-2.5-flash-lite-preview', cached: false };

  it('keeps the perception provenance and description instead of a 120-character JSON clip', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    const description = '一只黑色的猫，背景是 GitHub 的标志。'.repeat(20);
    trace.record({ type: 'media_resolution', index: 0, mediaKind: 'image', status: 'derived', code: 'media_perception', provenance, description });
    const snapshot = trace.snapshot();
    expect(snapshot.media).toEqual([{
      index: 0, kind: 'image', status: 'derived', code: 'media_perception', provenance, description,
    }]);
    const entry = snapshot.timeline.find(item => item.kind === 'media_resolution')!;
    expect(entry.detail).toContain('services:vision-backup/gemini-2.5-flash-lite-preview');
    expect(entry.detail).toContain('识图');
    expect(entry.detail).not.toContain('…');
    const text = formatTurnTrace(snapshot);
    expect(text).toContain('gemini-2.5-flash-lite-preview');
    expect(text).toContain(description);
  });

  it('caps a very long description and says it was truncated and how long it was', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    const description = 'x'.repeat(MEDIA_DESCRIPTION_TRACE_LENGTH + 500);
    trace.record({ type: 'media_resolution', index: 0, mediaKind: 'image', status: 'derived', code: 'media_perception',
      provenance: { ...provenance, cached: true }, description });
    const [media] = trace.snapshot().media!;
    expect(media!.description!.length).toBeLessThanOrEqual(MEDIA_DESCRIPTION_TRACE_LENGTH + 1);
    expect(media).toMatchObject({ description_truncated: true, description_chars: MEDIA_DESCRIPTION_TRACE_LENGTH + 500 });
    expect(trace.snapshot().timeline.find(item => item.kind === 'media_resolution')!.detail).toContain('缓存命中');
    expect(formatTurnTrace(trace.snapshot())).toContain(`已截断，共 ${MEDIA_DESCRIPTION_TRACE_LENGTH + 500} 字符`);
  });

  it('counts the perception call as a model call of the turn, with its purpose, in trace and ai.usage', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' }, () => 0);
    trace.record({ type: 'usage', purpose: 'media_perception', provider: 'g', model: 'vision', durationMs: 900,
      usage: { promptTokens: 300, completionTokens: 12, totalTokens: 312 } });
    trace.record({ type: 'usage', provider: 'p', model: 'chat', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    trace.record({ type: 'turn_end', output: [], usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    const snapshot = trace.snapshot();
    expect(snapshot.model_calls).toHaveLength(2);
    expect(snapshot.model_calls[0]).toMatchObject({ purpose: 'media_perception', provider: 'g', model: 'vision', total_tokens: 312 });
    expect(snapshot.usage.total_tokens).toBe(422);
    expect(snapshot.timeline.find(item => item.kind === 'model_call')!.detail).toContain('识图');
    expect(formatTurnTrace(snapshot)).toMatch(/#1 in=300 out=12 .*识图/u);
    const logs = formatTurnUsageLogs(snapshot, { traceId: 'tr', scene: 'x' });
    expect(logs.summary).toContain('calls: 2');
    expect(logs.summary).toContain('g/vision');
    expect(logs.details[0]).toContain('purpose: media_perception');
  });

  it('zhin trace prints an estimated call as `?` and says the totals include estimates (#1250)', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' }, () => 0);
    trace.record({ type: 'usage', purpose: 'media_perception', provider: 'g', model: 'vision', stopReason: 'aborted',
      usage: { promptTokens: 1_050, completionTokens: 0, totalTokens: 1_050, reported: { input: false, output: false, totalTokens: false } } });
    trace.record({ type: 'usage', provider: 'p', model: 'chat', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    trace.record({ type: 'turn_end', output: [], usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    const text = formatTurnTrace(trace.snapshot());
    expect(text).toMatch(/#1 in=\? out=\? .*识图/u);
    expect(text).not.toMatch(/#1 in=1050/u);
    expect(text).toMatch(/#2 in=100 out=10/u);
    expect(text).toMatch(/合计 1160（含估算）/u);
    // Consistent with `[ai.usage]`: the unreported call shows `?` there too.
    expect(formatTurnUsageLogs(trace.snapshot(), { traceId: 'tr', scene: 'x' }).details[0]).toContain('input: ?');

    const plain = new TurnTraceCollector({ turnId: 't2', sessionKey: 's' }, () => 0);
    plain.record({ type: 'usage', provider: 'p', model: 'chat', usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 } });
    expect(formatTurnTrace(plain.snapshot())).not.toContain('含估算');
  });

  it('redacts credentials in a description (#1250)', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    const secret = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    trace.record({ type: 'media_resolution', index: 0, mediaKind: 'image', status: 'derived', code: 'media_perception', provenance,
      description: `截图里写着 api_key=${secret} 和 Bearer ${secret}` });
    const snapshot = trace.snapshot();
    expect(snapshot.media![0]!.description).not.toContain(secret);
    expect(formatTurnTrace(snapshot)).not.toContain(secret);
  });

  it('strips terminal control sequences (CSI / OSC, C0 / C1) from a description before it is printed (#1250)', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' });
    const hostile = 'cat\u001b[2J\u001b]0;pwned\u0007\u009b31m\u0000done';
    trace.record({ type: 'media_resolution', index: 0, mediaKind: 'image', status: 'derived', code: 'media_perception',
      provenance: { ...provenance, model: 'm\u001b[31m' }, description: hostile });
    const snapshot = trace.snapshot();
    const control = /[\u0000-\u001f\u007f-\u009f]/u;
    expect(snapshot.media![0]!.description).not.toMatch(control);
    expect(snapshot.media![0]!.provenance!.model).not.toMatch(control);
    expect(snapshot.media![0]!.description).toContain('cat');
    expect(snapshot.media![0]!.description).toContain('done');
    // A trace stored before stripping is still printed safely.
    const stored = { ...snapshot, media: [{ ...snapshot.media![0]!, description: hostile }] };
    const printed = formatTurnTrace(stored as never).split('\n').join('');
    expect(printed).not.toMatch(control);
  });

  it('a perception estimate is marked as not reported: ai.usage shows no figure for it', () => {
    const trace = new TurnTraceCollector({ turnId: 't', sessionKey: 's' }, () => 0);
    trace.record({ type: 'usage', purpose: 'media_perception', provider: 'g', model: 'vision', stopReason: 'error',
      usage: { promptTokens: 1_050, completionTokens: 0, totalTokens: 1_050, reported: { input: false, output: false, totalTokens: false } } });
    const logs = formatTurnUsageLogs(trace.snapshot(), { traceId: 'tr', scene: 'x' });
    expect(logs.details[0]).toContain('status: error');
    expect(logs.details[0]).not.toContain('1050');
  });
});
