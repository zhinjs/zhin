#!/usr/bin/env node
/**
 * Gemini quota probe for the nightly tier (workflow_dispatch `mode: quota-probe`).
 *
 * 1. Lists the models the CI key can see (flash-lite family + the probe model) via
 *    GET /models, to confirm the model id.
 * 2. Sends tiny generateContent requests back to back (no pacing) and records what
 *    the API's 429s say: the violated quota id, its `quotaValue` (the real limit) and
 *    `retryDelay`. A per-minute 429 gives the RPM; after waiting its retryDelay the
 *    probe keeps going until a per-day 429 (the RPD), PROBE_MAX_REQUESTS, or
 *    PROBE_MAX_MINUTES. 503s are counted and retried after 10 s.
 *
 * It burns quota on purpose. The key is sent only as the x-goog-api-key header and
 * is never logged; only model names, status codes and quota metadata are printed.
 *
 * Env: GEMINI_API_KEY (required), GEMINI_BASE_URL (optional), PROBE_MODEL,
 * PROBE_MAX_REQUESTS (default 40), PROBE_MAX_MINUTES (default 30), PROBE_CONCURRENCY
 * (default 1; >1 sends that many at once, to reach the per-minute limit despite latency),
 * PROBE_REPORT (default eval-reports/quota-probe.json).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const env = process.env;
const key = env.GEMINI_API_KEY?.trim();
if (!key) {
  console.error('GEMINI_API_KEY is not set');
  process.exit(1);
}
const base = (env.GEMINI_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
const model = env.PROBE_MODEL?.trim() || 'gemini-3.5-flash-lite';
const maxRequests = Number(env.PROBE_MAX_REQUESTS) > 0 ? Number(env.PROBE_MAX_REQUESTS) : 40;
const deadline = Date.now() + (Number(env.PROBE_MAX_MINUTES) > 0 ? Number(env.PROBE_MAX_MINUTES) : 30) * 60_000;
const concurrency = Math.max(1, Math.min(Number(env.PROBE_CONCURRENCY) || 1, 50));
const reportPath = env.PROBE_REPORT || 'eval-reports/quota-probe.json';
const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function listModels() {
  const names = [];
  let pageToken = '';
  do {
    const res = await fetch(`${base}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, { headers });
    if (!res.ok) return { status: res.status, models: names };
    const body = await res.json();
    for (const m of body.models ?? []) names.push(m);
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return { status: 200, models: names };
}

function quotaInfo(body) {
  const details = body?.error?.details ?? [];
  const violations = details.flatMap((d) => (String(d['@type']).endsWith('QuotaFailure') ? d.violations ?? [] : []));
  const retry = details.find((d) => String(d['@type']).endsWith('RetryInfo'))?.retryDelay;
  return {
    status: body?.error?.status,
    violations: violations.map((v) => ({ quotaId: v.quotaId, quotaValue: v.quotaValue, quotaMetric: v.quotaMetric })),
    retryDelay: retry,
  };
}

const listed = await listModels();
const flashLite = listed.models
  .filter((m) => /flash-lite/.test(m.name) || m.name === `models/${model}`)
  .map((m) => ({ name: m.name, displayName: m.displayName, inputTokenLimit: m.inputTokenLimit, methods: m.supportedGenerationMethods }));
console.log(`[probe] models list: HTTP ${listed.status}, ${listed.models.length} models; flash-lite family:`);
for (const m of flashLite) console.log(`[probe]   ${m.name} (${m.displayName}) methods=${(m.methods ?? []).join(',')}`);
const modelListed = listed.models.some((m) => m.name === `models/${model}`);
console.log(`[probe] ${model} listed: ${modelListed}`);

const t0 = Date.now();
const log = [];
const limits = {};
let ok = 0;
let rejected429 = 0;
let unavailable = 0;
let otherErrors = 0;
let sent = 0;
let stopReason = 'max requests';
let stopped = false;
async function worker() {
  while (!stopped && sent < maxRequests) {
    if (Date.now() > deadline) { stopReason = 'time limit'; stopped = true; break; }
    sent += 1;
    const n = sent;
    const at = Date.now() - t0;
    let res;
    try {
      res = await fetch(`${base}/models/${model}:generateContent`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }], generationConfig: { maxOutputTokens: 16 } }),
      });
    } catch (error) {
      otherErrors += 1;
      console.log(`[probe] #${n} network error: ${error?.name ?? 'Error'}`);
      if (otherErrors >= 3) { stopReason = 'network errors'; stopped = true; }
      await sleep(5_000);
      continue;
    }
    if (res.ok) {
      ok += 1;
      await res.text();
      continue;
    }
    let body;
    try { body = await res.json(); } catch { body = undefined; }
    const info = quotaInfo(body);
    log.push({ n, atMs: at, http: res.status, okSoFar: ok, ...info, retryAfter: res.headers.get('retry-after') ?? undefined });
    console.log(`[probe] #${n} t=${(at / 1000).toFixed(1)}s HTTP ${res.status} ${info.status ?? ''} ok=${ok} ${info.violations.map((v) => `${v.quotaId}=${v.quotaValue}`).join(' ')} retryDelay=${info.retryDelay ?? '-'}`);
    if (res.status === 429) {
      rejected429 += 1;
      const ids = info.violations.map((v) => v.quotaId ?? '').join(' ');
      for (const v of info.violations) if (v.quotaId) limits[v.quotaId] = v.quotaValue;
      if (/PerDay/.test(ids)) { stopReason = 'per-day 429'; stopped = true; break; }
      if (env.PROBE_STOP_ON_RPM === '1') { stopReason = 'per-minute 429'; stopped = true; break; }
      await sleep(Math.min(Math.max(Math.ceil(parseFloat(info.retryDelay ?? '10')) * 1000, 1000), 70_000));
    } else if (res.status === 503) {
      unavailable += 1;
      await sleep(10_000);
    } else {
      otherErrors += 1;
      if (otherErrors >= 3) { stopReason = `HTTP ${res.status}`; stopped = true; break; }
      await sleep(5_000);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const summary = {
  model,
  modelListed,
  concurrency,
  flashLiteFamily: flashLite,
  sent,
  ok,
  rejected429,
  unavailable,
  otherErrors,
  stopReason,
  limits,
  elapsedS: Math.round((Date.now() - t0) / 1000),
  finishedAt: new Date().toISOString(),
  log,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[probe] done: ${JSON.stringify({ model, modelListed, sent, ok, rejected429, unavailable, otherErrors, stopReason, limits, elapsedS: summary.elapsedS })}`);
if (env.GITHUB_STEP_SUMMARY) {
  const md = [
    `# Gemini quota probe: ${model}`,
    '',
    `Listed by /models: ${modelListed}. Flash-lite family: ${flashLite.map((m) => m.name.replace('models/', '')).join(', ') || 'none'}`,
    '',
    `Sent ${sent} · ok ${ok} · 429 ${rejected429} · 503 ${unavailable} · other ${otherErrors} · stopped: ${stopReason} · ${summary.elapsedS}s`,
    '',
    ...Object.entries(limits).map(([id, value]) => `- \`${id}\`: ${value}`),
  ].join('\n');
  await writeFile(env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: 'a' });
}
