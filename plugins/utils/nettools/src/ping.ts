import { type Locale } from 'zhin.js/i18n';
import { messages } from './presentation.js';
import { message } from './messages.js';
/**
 * Multi-region ping through check-host.net's public API.
 *
 * Flow: `GET /check-ping?host=…&max_nodes=N` returns a request id plus the
 * chosen probe nodes; `GET /check-result/<id>` returns one entry per node,
 * `null` while that node is still working. We poll a bounded number of times
 * and report whatever finished; unfinished nodes are shown as "no result".
 *
 * Result shape per node (tolerantly parsed, anything else is ignored):
 *   [[ ["OK", 0.044, "93.184.216.34"], ["TIMEOUT", 3.0], … ]]   finished
 *   [[ null ]]                                                   could not resolve
 *   null                                                         still running
 */
import { NettoolsError } from './errors.js';
import type { HttpClient } from './http.js';

export const CHECK_HOST_BASE_URL = 'https://check-host.net/';
const PROVIDER = 'check-host.net';

export interface PingOptions {
  readonly maxNodes: number;
  readonly pollIntervalMs: number;
  readonly maxPolls: number;
  readonly signal?: AbortSignal;
}

export interface PingNode {
  readonly id: string;
  readonly countryCode: string;
  readonly country: string;
  readonly city: string;
}

export type PingNodeResult =
  | { readonly state: 'pending' }
  | { readonly state: 'unresolved' }
  | {
      readonly state: 'done';
      readonly sent: number;
      readonly received: number;
      readonly averageMs: number | undefined;
      readonly minMs: number | undefined;
      readonly maxMs: number | undefined;
      readonly address: string | undefined;
    };

export interface PingReport {
  readonly host: string;
  readonly permanentLink: string | undefined;
  readonly nodes: readonly { readonly node: PingNode; readonly result: PingNodeResult }[];
}

interface StartedCheck {
  readonly requestId: string;
  readonly permanentLink: string | undefined;
  readonly nodes: readonly PingNode[];
}

export async function runMultiRegionPing(http: HttpClient, host: string, options: PingOptions): Promise<PingReport> {
  const started = await startPingCheck(http, host, options);
  let results = new Map<string, PingNodeResult>();
  let anyPollSucceeded = false;
  let lastPollError: unknown;
  for (let poll = 0; poll < options.maxPolls; poll += 1) {
    await http.dependencies.sleep(options.pollIntervalMs, options.signal);
    try {
      results = await fetchPingResults(http, started.requestId, options.signal);
      anyPollSucceeded = true;
    } catch (error) {
      // One failed poll (after its own retries) should not discard a check
      // that is still running remotely; keep polling until the budget is used.
      if (error instanceof NettoolsError && error.kind === 'aborted') {
        throw error;
      }
      lastPollError = error;
      continue;
    }
    const allFinished = started.nodes.every((node) => {
      const result = results.get(node.id);
      return result !== undefined && result.state !== 'pending';
    });
    if (allFinished) {
      break;
    }
  }
  if (!anyPollSucceeded && lastPollError !== undefined) {
    throw lastPollError;
  }
  const nodes = started.nodes.map((node) => ({
    node,
    result: results.get(node.id) ?? ({ state: 'pending' } as const),
  }));
  return Object.freeze({ host, permanentLink: started.permanentLink, nodes: Object.freeze(nodes) });
}

async function startPingCheck(http: HttpClient, host: string, options: PingOptions): Promise<StartedCheck> {
  const url = new URL('check-ping', CHECK_HOST_BASE_URL);
  url.searchParams.set('host', host);
  url.searchParams.set('max_nodes', String(options.maxNodes));
  const response = await http.fetchJson(url, {
    provider: PROVIDER,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return parseStartResponse(response.body);
}

export function parseStartResponse(body: unknown): StartedCheck {
  if (!isRecord(body)) {
    throw malformed();
  }
  if (typeof body.error === 'string' && body.error.length > 0) {
    throw new NettoolsError('http', message('pingRefused', { detail: body.error }));
  }
  const requestId = body.request_id;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9]{1,64}$/u.test(requestId)) {
    throw malformed();
  }
  const nodes: PingNode[] = [];
  if (isRecord(body.nodes)) {
    for (const [id, info] of Object.entries(body.nodes)) {
      nodes.push(parseNodeInfo(id, info));
    }
  }
  if (nodes.length === 0) {
    throw malformed();
  }
  const permanentLink = typeof body.permanent_link === 'string' && body.permanent_link.startsWith('https://')
    ? body.permanent_link
    : undefined;
  return Object.freeze({ requestId, permanentLink, nodes: Object.freeze(nodes) });
}

function parseNodeInfo(id: string, info: unknown): PingNode {
  const fields = Array.isArray(info) ? info : [];
  const text = (index: number): string => {
    const value = fields[index];
    return typeof value === 'string' ? value : '';
  };
  return Object.freeze({
    id,
    countryCode: text(0).toUpperCase(),
    country: text(1),
    city: text(2),
  });
}

async function fetchPingResults(http: HttpClient, requestId: string, signal?: AbortSignal): Promise<Map<string, PingNodeResult>> {
  const url = new URL(`check-result/${encodeURIComponent(requestId)}`, CHECK_HOST_BASE_URL);
  const response = await http.fetchJson(url, {
    provider: PROVIDER,
    ...(signal ? { signal } : {}),
  });
  return parsePingResults(response.body);
}

export function parsePingResults(body: unknown): Map<string, PingNodeResult> {
  if (!isRecord(body)) {
    throw malformed();
  }
  const results = new Map<string, PingNodeResult>();
  for (const [nodeId, raw] of Object.entries(body)) {
    results.set(nodeId, parseNodeResult(raw));
  }
  return results;
}

function parseNodeResult(raw: unknown): PingNodeResult {
  if (raw === null || raw === undefined) {
    return { state: 'pending' };
  }
  const outer = Array.isArray(raw) ? raw : [];
  const probes = Array.isArray(outer[0]) ? outer[0] : [];
  const firstProbe = probes[0];
  if (probes.length === 0 || firstProbe === null) {
    return { state: 'unresolved' };
  }
  const latencies: number[] = [];
  let address: string | undefined;
  let sent = 0;
  for (const probe of probes) {
    if (!Array.isArray(probe)) {
      continue;
    }
    sent += 1;
    const [status, seconds, ip] = probe as unknown[];
    if (address === undefined && typeof ip === 'string') {
      address = ip;
    }
    if (status === 'OK' && typeof seconds === 'number' && Number.isFinite(seconds)) {
      latencies.push(seconds * 1000);
    }
  }
  if (sent === 0) {
    return { state: 'unresolved' };
  }
  const received = latencies.length;
  const total = latencies.reduce((sum, value) => sum + value, 0);
  return {
    state: 'done',
    sent,
    received,
    averageMs: received > 0 ? total / received : undefined,
    minMs: received > 0 ? Math.min(...latencies) : undefined,
    maxMs: received > 0 ? Math.max(...latencies) : undefined,
    address,
  };
}

export function formatPingReport(report: PingReport, locale: Locale = 'zh-CN'): string {
  const lines = [messages(locale, 'pingHeader', { host: report.host })];
  for (const { node, result } of report.nodes) {
    const place = [node.countryCode, node.city || node.country].filter(Boolean).join(' ') || node.id;
    lines.push(`${place}：${describeNodeResult(result, locale)}`);
  }
  if (report.permanentLink) {
    lines.push(messages(locale, 'detail', { link: report.permanentLink }));
  }
  return lines.join('\n');
}

function describeNodeResult(result: PingNodeResult, locale: Locale): string {
  if (result.state === 'pending') {
    return messages(locale, 'pending');
  }
  if (result.state === 'unresolved') {
    return messages(locale, 'unresolved');
  }
  const loss = Math.round(((result.sent - result.received) / result.sent) * 100);
  const via = result.address ? ` → ${result.address}` : '';
  if (result.averageMs === undefined) {
    return messages(locale, 'allTimeout', { loss, via });
  }
  const average = result.averageMs.toFixed(1);
  const min = (result.minMs ?? result.averageMs).toFixed(1);
  const max = (result.maxMs ?? result.averageMs).toFixed(1);
  return messages(locale, 'pingStats', { average, min, max, loss, via });
}

function malformed(): NettoolsError {
  return new NettoolsError('malformed', message('pingMalformed'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
