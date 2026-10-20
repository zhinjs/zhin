import { isAbsolute } from 'node:path';
export const PLATFORMS = ['qq', 'telegram', 'onebot11', 'napcat', 'discord', 'slack', 'kook', 'email', 'lark', 'dingtalk', 'line'];
export function configuredMode(platform, config) {
  if (platform === 'telegram') return config.polling === false ? 'webhook' : 'polling';
  if (platform === 'qq') return config.mode ?? 'websocket';
  if (platform === 'slack') return config.socketMode === false ? 'http' : 'socket';
  if (platform === 'email') return 'smtp-imap';
  if (platform === 'line') return 'webhook';
  if (platform === 'lark' || platform === 'dingtalk') return config.mode ?? 'webhook';
  return config.connection ?? ({ discord: 'gateway', kook: 'websocket' }[platform] ?? 'ws');
}
export const SCENARIOS = ['text-roundtrip', 'markdown-roundtrip', 'button-roundtrip', 'share-roundtrip', 'quote-roundtrip', 'media-roundtrip', 'recall', 'interaction', 'account-isolation', 'network-recovery', 'rate-limit', 'permission-denied', 'hot-reload', 'production-restart', 'duplicate-delivery', 'send-unknown', 'soak'];
export function validatePolicy(policy) {
  if (policy.version !== 1 || !PLATFORMS.includes(policy.platform)) throw new Error('Unsupported policy version/platform');
  if (!policy.mode || !Array.isArray(policy.targets) || !policy.targets.length) throw new Error('Mode and explicit targets required');
  if (!Array.isArray(policy.actions) || !policy.actions.length || policy.actions.some(action => !['reply-text', 'reply-markdown', 'reply-button', 'reply-share', 'reply-image', 'reply-quote', 'reply-interaction', 'reply-recall', 'account-marker'].includes(action))) throw new Error('Unknown acceptance action');
  if (!Number.isInteger(policy.minIntervalMs) || policy.minIntervalMs < 1000 || !Number.isInteger(policy.maxSends) || policy.maxSends < 1) throw new Error('Explicit interval >=1000ms and send budget required');
  if (!isAbsolute(policy.eventsPath)) throw new Error('Absolute local evidence path required');
  const aliases = new Set();
  for (const target of policy.targets) {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(target.alias) || aliases.has(target.alias) || !target.adapter || !target.endpoint || !target.id || !['private', 'group', 'channel'].includes(target.kind)) throw new Error('Invalid or duplicate target');
    aliases.add(target.alias);
  }
  if (policy.bridge && (typeof policy.bridge.name !== 'string' || !policy.bridge.name.trim() || typeof policy.bridge.version !== 'string' || !policy.bridge.version.trim())) throw new Error('Bridge name/version must be nonempty strings');
  if (policy.soak && (!Number.isInteger(policy.soak.minConfirmed) || policy.soak.minConfirmed < 1 || !Number.isInteger(policy.soak.maxGapMs) || policy.soak.maxGapMs < 1000 || !Number.isInteger(policy.soak.maxRssGrowthBytes) || policy.soak.maxRssGrowthBytes < 0)) throw new Error('Invalid soak criteria');
  return policy;
}
export function durationMs(value) {
  const match = /^(\d+)(s|m|h)$/.exec(value);
  if (!match || Number(match[1]) < 1) throw new Error('Duration must be e.g. 30s, 24h or 72h');
  const result = Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000 }[match[2]]);
  if (result > 72 * 3600000) throw new Error('Maximum observation duration is 72h');
  return result;
}
export function aggregateEvents(events, aliases) {
  const seen = new Set();
  const bindings = new Map();
  const outcomes = new Map();
  const counts = { inbound: 0, attempted: 0, confirmed: 0, failed: 0, unknown: 0, unsupported: 0, duplicate: 0, blocked: 0 };
  const latencies = []; const resourceSamples = []; const evidence = [];
  for (const event of events) {
    if (event.version !== 1 || !aliases.includes(event.target) || !/^[a-f0-9]{64}$/.test(event.sample) || !Number.isFinite(Date.parse(event.time))) throw new Error('Invalid evidence event');
    if (!['confirmed', 'failed', 'unknown', 'blocked', 'unsupported'].includes(event.result)) throw new Error('Invalid event result');
    if (event.platform !== undefined && !PLATFORMS.includes(event.platform)) throw new Error('Invalid observed platform');
    if (event.action !== undefined && !['reply-text', 'reply-markdown', 'reply-button', 'reply-share', 'reply-image', 'reply-quote', 'reply-interaction', 'reply-recall', 'account-marker'].includes(event.action)) throw new Error('Invalid evidence action');
    if (event.phase !== undefined && !['attempt', 'result'].includes(event.phase)) throw new Error('Invalid evidence phase');
    if (event.transportState !== undefined && !['idle', 'connecting', 'open', 'reconnecting', 'closed', 'stopped', 'unknown'].includes(event.transportState)) throw new Error('Invalid transport state');
    const binding = bindings.get(event.sample);
    if (binding && (binding.target !== event.target || binding.action !== undefined && event.action !== undefined && binding.action !== event.action)) throw new Error('Evidence sample cannot change target or action');
    bindings.set(event.sample, { target: event.target, action: event.action ?? binding?.action });
    if (event.phase === 'attempt') { outcomes.set(event.sample, event); continue; }
    counts.inbound++;
    if (seen.has(event.sample)) counts.duplicate++; seen.add(event.sample);
    if (event.result === 'blocked') counts.blocked++;
    else if (event.result === 'unsupported') outcomes.set(event.sample, event);
    else outcomes.set(event.sample, event);
    if (Number.isFinite(event.latencyMs) && event.latencyMs >= 0) latencies.push(event.latencyMs);
    if (Number.isFinite(event.rssBytes) && event.rssBytes > 0) resourceSamples.push({ time: event.time, rssBytes: event.rssBytes, ...(Number.isInteger(event.pid) ? { pid: event.pid } : {}) });
    // Whitelist fields only: remote bodies, chat contents, credentials and IDs never propagate.
    evidence.push({ sample: event.sample, target: event.target, time: event.time, result: event.result, ...(event.platform ? { platform: event.platform } : {}), ...(event.action ? { action: event.action } : {}), ...(event.phase ? { phase: event.phase } : {}), ...(typeof event.callbackObserved === 'boolean' ? { callbackObserved: event.callbackObserved } : {}), ...(['source-message', 'payload-conversation-actor'].includes(event.callbackAssociation) ? { callbackAssociation: event.callbackAssociation } : {}), ...(['rgb', 'legacy'].includes(event.imageSample) ? { imageSample: event.imageSample } : {}), ...(Number.isInteger(event.generation) ? { generation: event.generation } : {}), ...(Number.isInteger(event.pid) ? { pid: event.pid } : {}), ...(event.transportState ? { transportState: event.transportState, admitted: event.admitted === true } : {}) });
  }
  for (const event of outcomes.values()) { counts.attempted++; counts[event.result]++; if (event.phase === 'attempt') evidence.push({ sample: event.sample, target: event.target, time: event.time, result: 'unknown', action: event.action, phase: 'unresolved' }); }
  latencies.sort((a, b) => a - b);
  return { counts, latency: { samples: latencies.length, p50Ms: latencies[Math.floor(latencies.length * .5)] ?? null, p95Ms: latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * .95))] ?? null }, resourceSamples, evidence };
}

export function assessScenarios({ aggregate, operators, targets, startedAt, finishedAt, durationRequestedMs, interrupted, resourceSamples, soak }) {
  const actions = { 'text-roundtrip': 'reply-text', 'markdown-roundtrip': 'reply-markdown', 'button-roundtrip': 'reply-button', 'share-roundtrip': 'reply-share', 'quote-roundtrip': 'reply-quote', 'media-roundtrip': 'reply-image', recall: 'reply-recall', interaction: 'reply-interaction', 'account-isolation': 'account-marker' };
  const terminal = aggregate.evidence.filter(item => item.phase !== 'attempt');
  const bad = item => ['failed', 'unknown'].includes(item.result);
  return SCENARIOS.map(name => {
    let samples = actions[name] ? terminal.filter(item => item.action === actions[name]) : [];
    const observations = operators.filter(item => item.scenario === name && item.phase !== 'begin');
    const operatorFailed = observations.some(item => item.status === 'fail');
    let status = samples.some(bad) || operatorFailed ? 'fail' : 'blocked';
    if (actions[name]) {
      if (status !== 'fail' && samples.length && samples.every(item => item.result === 'unsupported')) status = 'unsupported';
      if (status === 'blocked' && samples.some(item => item.result === 'confirmed')) status = 'pass';
      if (['quote-roundtrip', 'media-roundtrip', 'recall', 'markdown-roundtrip', 'button-roundtrip', 'share-roundtrip', 'account-isolation'].includes(name) && status === 'pass') {
        // API acceptance does not prove that a native quote/image was rendered or a
        // message disappeared. Each exercised target needs later retained visible evidence.
        const confirmed = samples.filter(item => item.result === 'confirmed');
        const visible = observations.filter(item => item.status === 'pass' && item.phase === 'observation'
          && typeof item.evidenceLabel === 'string' && item.evidenceLabel.trim()
          && Number.isFinite(Date.parse(item.time)));
        if (confirmed.some(item => !targets.some(target => target.alias === item.target)
          || !visible.some(observation => observation.target === item.target
            && Date.parse(observation.time) >= Date.parse(item.time)))) status = 'blocked';
      }
      if (name === 'button-roundtrip' && status === 'pass' && samples.some(item => item.result === 'confirmed' && item.callbackObserved !== true)) status = 'blocked';
      if (name === 'account-isolation' && status === 'pass') {
        const identities = new Set(samples.filter(item => item.result === 'confirmed').map(item => { const target = targets.find(t => t.alias === item.target); return target ? `${target.adapter}\0${target.endpoint}` : undefined; }).filter(Boolean));
        if (identities.size < 2 || !observations.some(item => item.status === 'pass')) status = 'blocked';
      }
    } else if (['network-recovery', 'hot-reload', 'production-restart', 'rate-limit', 'permission-denied'].includes(name)) {
      const end = operators.findLast(item => item.scenario === name && item.phase === 'end');
      const begin = end && operators.findLast(item => item.scenario === name && item.phase === 'begin' && item.target === end.target && Date.parse(item.time) <= Date.parse(end.time));
      if (end && begin) {
        const targetSamples = terminal.filter(item => item.target === end.target);
        const baseline = targetSamples.findLast(item => item.result === 'confirmed' && Date.parse(item.time) < Date.parse(begin.time));
        const after = targetSamples.find(item => item.result === 'confirmed' && Date.parse(item.time) >= Date.parse(end.time));
        samples = targetSamples.filter(item => Date.parse(item.time) >= Date.parse(begin.time) && (!after || Date.parse(item.time) <= Date.parse(after.time)));
        const faultExpected = ['network-recovery', 'rate-limit', 'permission-denied'].includes(name);
        // Only explicit known failures inside the intended fault window may be expected.
        const unexpected = samples.some(item => item.result === 'unknown' || item.result === 'failed' && (!faultExpected || Date.parse(item.time) >= Date.parse(end.time)));
        if (operatorFailed || unexpected) status = 'fail';
        else if (baseline && after && end.status === 'pass') {
          if (name === 'hot-reload') status = Number.isInteger(baseline.generation) && Number.isInteger(after.generation) && baseline.generation !== after.generation ? 'pass' : 'blocked';
          else if (name === 'production-restart') status = Number.isInteger(baseline.pid) && Number.isInteger(after.pid) && baseline.pid !== after.pid ? 'pass' : 'blocked';
          else if (['rate-limit', 'permission-denied'].includes(name)) status = samples.some(item => item.result === 'failed' && Date.parse(item.time) < Date.parse(end.time)) ? 'pass' : 'blocked';
          else status = 'pass';
        }
      }
    } else if (name === 'duplicate-delivery') {
      const accepted = observations.filter(item => item.status === 'pass' && item.phase === 'observation'
        && typeof item.evidenceLabel === 'string' && item.evidenceLabel.trim() && Number.isFinite(Date.parse(item.time)));
      samples = terminal.filter(item => accepted.some(obs => obs.target === item.target));
      if (operatorFailed || samples.some(bad)) status = 'fail';
      else if (samples.some(item => item.result === 'blocked'
        && accepted.some(obs => obs.target === item.target && Date.parse(obs.time) >= Date.parse(item.time))
        && samples.some(previous => previous.sample === item.sample && previous.target === item.target
          && previous.action === item.action && previous.result === 'confirmed' && Date.parse(previous.time) <= Date.parse(item.time)))) status = 'pass';
    } else if (name === 'send-unknown') {
      const reconciled = observations.filter(item => item.status === 'pass' && ['accepted', 'not-delivered'].includes(item.reconciliation));
      samples = terminal.filter(item => item.result === 'unknown' && reconciled.some(obs => obs.target === item.target && Date.parse(obs.time) >= Date.parse(item.time)));
      if (operatorFailed) status = 'fail';
      else if (samples.length) status = 'pass'; // Unknown counters remain unchanged even after operator reconciliation.
    } else if (name === 'soak') {
      samples = terminal;
      const confirmed = samples.filter(item => item.result === 'confirmed');
      const times = [Date.parse(startedAt), ...confirmed.map(e => Date.parse(e.time)).sort((a, b) => a - b), Date.parse(finishedAt)];
      const maxGap = Math.max(...times.slice(1).map((time, index) => time - times[index]));
      const rssGrowth = resourceSamples.length > 1 ? Math.max(...resourceSamples.map(item => item.rssBytes)) - resourceSamples[0].rssBytes : Infinity;
      const probePids = new Set(confirmed.map(item => item.pid).filter(Number.isInteger));
      const sampledPid = probePids.size === 1 ? [...probePids][0] : undefined;
      const resourceCoverage = resourceSamples.length >= 2 && sampledPid !== undefined && resourceSamples.every(item => item.pid === sampledPid)
        && Date.parse(resourceSamples[0].time) - Date.parse(startedAt) <= 45000
        && Date.parse(finishedAt) - Date.parse(resourceSamples.at(-1).time) <= 45000
        && resourceSamples.slice(1).every((item, index) => Date.parse(item.time) - Date.parse(resourceSamples[index].time) <= 45000);
      status = operatorFailed || aggregate.counts.failed || aggregate.counts.unknown || interrupted ? 'fail' : 'blocked';
      if (status !== 'fail' && soak && durationRequestedMs >= 86400000 && Date.parse(finishedAt) - Date.parse(startedAt) >= durationRequestedMs && confirmed.length >= soak.minConfirmed && maxGap <= soak.maxGapMs && resourceCoverage && rssGrowth <= soak.maxRssGrowthBytes && observations.some(item => item.status === 'pass')) status = 'pass';
    }
    return { name, status, samples: samples.length, source: observations.length ? 'operator-and-probe' : 'probe', evidencePaths: [...new Set([...(samples.length ? ['probe-events'] : []), ...observations.map(item => item.evidenceLabel)])] };
  });
}

/** Same default key convention as scaffold-wizard packageToInstanceKey. */
export function manifestAdapterMatches(entry, instanceKey, packageName) {
  const reference = typeof entry === 'string' ? { package: entry } : entry;
  if (!reference || reference.package !== packageName) return false;
  const shortName = packageName.includes('/') ? packageName.split('/').at(-1) : packageName;
  const key = reference.instanceKey ?? shortName.replace(/^(adapter|plugin|service)-/, '');
  return key === instanceKey;
}
