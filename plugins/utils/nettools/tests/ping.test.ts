import { describe, expect, it } from 'vitest';
import { NettoolsError } from '../src/errors.js';
import { formatPingReport, parsePingResults, parseStartResponse, runMultiRegionPing } from '../src/ping.js';
import { createClient, createFakeNetwork, json, sequence } from './helpers.js';

const START = {
  ok: 1,
  request_id: 'abc123',
  permanent_link: 'https://check-host.net/check-report/abc123',
  nodes: {
    'de1.node.check-host.net': ['de', 'Germany', 'Frankfurt', '1.1.1.1', 'AS1'],
    'jp1.node.check-host.net': ['jp', 'Japan', 'Tokyo', '2.2.2.2', 'AS2'],
    'us1.node.check-host.net': ['us', 'USA', 'Los Angeles', '3.3.3.3', 'AS3'],
  },
};

const OPTIONS = { maxNodes: 3, pollIntervalMs: 2_000, maxPolls: 3 };

describe('check-host parsing', () => {
  it('parses the start response', () => {
    const started = parseStartResponse(START);
    expect(started.requestId).toBe('abc123');
    expect(started.nodes.map((node) => node.city)).toEqual(['Frankfurt', 'Tokyo', 'Los Angeles']);
  });

  it.each([
    [null],
    [{}],
    [{ request_id: '../etc', nodes: START.nodes }],
    [{ request_id: 'abc', nodes: {} }],
  ])('rejects malformed start response %j', (body) => {
    expect(() => parseStartResponse(body)).toThrowError(NettoolsError);
  });

  it('surfaces a check-host error message', () => {
    expect(() => parseStartResponse({ error: 'limit_exceeded' })).toThrowError(/limit_exceeded/u);
  });

  it('parses finished, pending, unresolved and all-timeout nodes', () => {
    const results = parsePingResults({
      a: [[['OK', 0.01, '9.9.9.9'], ['OK', 0.03], ['TIMEOUT', 3], ['OK', 0.02]]],
      b: null,
      c: [[null]],
      d: [[['TIMEOUT', 3, '9.9.9.9'], ['TIMEOUT', 3]]],
      e: 'weird',
    });
    const finished = results.get('a');
    expect(finished).toMatchObject({ state: 'done', sent: 4, received: 3, address: '9.9.9.9' });
    expect(finished?.state === 'done' ? finished.averageMs : 0).toBeCloseTo(20, 5);
    expect(results.get('b')).toEqual({ state: 'pending' });
    expect(results.get('c')).toEqual({ state: 'unresolved' });
    expect(results.get('d')).toMatchObject({ state: 'done', received: 0, averageMs: undefined });
    expect(results.get('e')).toEqual({ state: 'unresolved' });
  });
});

describe('runMultiRegionPing', () => {
  it('starts a check with encoded params and polls until every node finished', async () => {
    const network = createFakeNetwork();
    network.route('check-host.net/check-ping', () => json(START));
    network.route(
      'check-host.net/check-result/abc123',
      sequence(
        () => json({ 'de1.node.check-host.net': [[['OK', 0.01, '9.9.9.9']]], 'jp1.node.check-host.net': null, 'us1.node.check-host.net': null }),
        () =>
          json({
            'de1.node.check-host.net': [[['OK', 0.01, '9.9.9.9']]],
            'jp1.node.check-host.net': [[['OK', 0.1, '9.9.9.9']]],
            'us1.node.check-host.net': [[null]],
          }),
      ),
    );
    const report = await runMultiRegionPing(createClient(network), 'example.com', OPTIONS);
    const startUrl = network.calls[0];
    expect(startUrl?.searchParams.get('host')).toBe('example.com');
    expect(startUrl?.searchParams.get('max_nodes')).toBe('3');
    expect(network.calls).toHaveLength(3);
    expect(network.sleeps).toEqual([2_000, 2_000]);
    const text = formatPingReport(report);
    expect(text).toContain('DE Frankfurt：平均 10.0ms');
    expect(text).toContain('US Los Angeles：无法解析或不可达');
    expect(text).toContain('https://check-host.net/check-report/abc123');
  });

  it('reports unfinished nodes after the bounded poll budget', async () => {
    const network = createFakeNetwork();
    network.route('check-host.net/check-ping', () => json(START));
    network.route('check-host.net/check-result/', () => json({ 'de1.node.check-host.net': [[['OK', 0.01]]] }));
    const report = await runMultiRegionPing(createClient(network), 'example.com', OPTIONS);
    expect(network.calls).toHaveLength(1 + OPTIONS.maxPolls);
    expect(formatPingReport(report)).toContain('JP Tokyo：未返回结果（超时）');
  });

  it('keeps polling when one poll fails', async () => {
    const network = createFakeNetwork();
    network.route('check-host.net/check-ping', () => json(START));
    network.route(
      'check-host.net/check-result/',
      sequence(
        () => json({}, 404),
        () => json({ 'de1.node.check-host.net': [[['OK', 0.01]]], 'jp1.node.check-host.net': [[['OK', 0.01]]], 'us1.node.check-host.net': [[['OK', 0.01]]] }),
      ),
    );
    const report = await runMultiRegionPing(createClient(network), 'example.com', OPTIONS);
    expect(report.nodes.every((entry) => entry.result.state === 'done')).toBe(true);
  });

  it('throws when every poll fails', async () => {
    const network = createFakeNetwork();
    network.route('check-host.net/check-ping', () => json(START));
    network.route('check-host.net/check-result/', () => json({}, 404));
    await expect(runMultiRegionPing(createClient(network), 'example.com', OPTIONS)).rejects.toMatchObject({ kind: 'http' });
  });
});
