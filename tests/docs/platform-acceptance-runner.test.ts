import { aggregateEvents, validatePolicy, durationMs, configuredMode, assessScenarios, manifestAdapterMatches } from '../../scripts/platform-acceptance/report.mjs';
const policy = { version: 1, platform: 'telegram', mode: 'polling', targets: [{ alias: 'private-a', adapter: 'root/telegram', endpoint: 'test-bot', kind: 'private', id: '123' }], actions: ['reply-text'], minIntervalMs: 1000, maxSends: 10, eventsPath: '/tmp/evidence.jsonl' };
it('preserves verified callback association boundaries without accepting arbitrary metadata', () => {
  const event = { version: 1, phase: 'result', action: 'reply-button', target: 'private-a', sample: 'a'.repeat(64), time: '2026-09-30T14:12:12Z', result: 'confirmed', callbackObserved: true };
  for (const callbackAssociation of ['source-message', 'payload-conversation-actor']) {
    expect(aggregateEvents([{ ...event, callbackAssociation }], ['private-a']).evidence[0].callbackAssociation).toBe(callbackAssociation);
  }
  expect(aggregateEvents([{ ...event, callbackAssociation: 'untrusted-value', rawPayload: 'do-not-export' }], ['private-a']).evidence[0]).not.toHaveProperty('callbackAssociation');
  expect(aggregateEvents([{ ...event, rawPayload: 'do-not-export' }], ['private-a']).evidence[0]).not.toHaveProperty('rawPayload');
});
it('projects only safe image sample labels without exporting media sources', () => {
  const event = { version: 1, phase: 'result', action: 'reply-image', target: 'private-a', sample: 'b'.repeat(64), time: '2026-09-30T14:12:12Z', result: 'confirmed' };
  for (const imageSample of ['rgb', 'legacy']) {
    const projected = aggregateEvents([{ ...event, imageSample, base64: 'sensitive-media', url: 'https://private.example/media', path: '/private/image.png', image: { file: 'sensitive-media' } }], ['private-a']).evidence[0];
    expect(projected.imageSample).toBe(imageSample);
    for (const field of ['base64', 'url', 'path', 'image']) expect(projected).not.toHaveProperty(field);
  }
  for (const imageSample of ['untrusted-value', { base64: 'sensitive-media' }, undefined]) {
    expect(aggregateEvents([{ ...event, imageSample }], ['private-a']).evidence[0]).not.toHaveProperty('imageSample');
  }
});
it('keeps additional platform evidence and real configuration modes distinct', () => {
  const cases = [
    ['discord', {}, 'gateway'], ['discord', { connection: 'interactions' }, 'interactions'],
    ['slack', {}, 'socket'], ['slack', { socketMode: false }, 'http'],
    ['kook', {}, 'websocket'], ['kook', { connection: 'webhook' }, 'webhook'],
    ['line', {}, 'webhook'], ['lark', {}, 'webhook'], ['lark', { mode: 'websocket' }, 'websocket'],
    ['dingtalk', {}, 'webhook'], ['dingtalk', { mode: 'stream' }, 'stream'],
    ['email', {}, 'smtp-imap'], ['telegram', { polling: false }, 'webhook'],
    ['napcat', { connection: 'http' }, 'http'], ['qq', { mode: 'webhook' }, 'webhook'],
  ] as const;
  for (const [platform, config, mode] of cases) {
    expect(configuredMode(platform, config)).toBe(mode);
    expect(validatePolicy({ ...policy, platform, mode }).platform).toBe(platform);
    const result = aggregateEvents([{ version: 1, platform, target: 'private-a', sample: 'a'.repeat(64), time: new Date().toISOString(), result: 'confirmed', phase: 'result' }], ['private-a']);
    expect(result.evidence[0].platform).toBe(platform);
  }
  expect(() => validatePolicy({ ...policy, platform: 'unimplemented' })).toThrow();
});
it('requires explicit targets, bounded actions, interval and budget', () => {
  expect(validatePolicy(policy)).toBe(policy);
  for (const change of [{ targets: [] }, { actions: ['send-anywhere'] }, { minIntervalMs: 0 }, { maxSends: 0 }, { eventsPath: './evidence' }]) expect(() => validatePolicy({ ...policy, ...change })).toThrow();
});
it('supports 24h/72h observations while bounding duration', () => {
  expect(durationMs('24h')).toBe(86400000); expect(durationMs('72h')).toBe(259200000);
  expect(() => durationMs('73h')).toThrow();
});
it('never treats an interrupted pending send as success and counts unknown separately', () => {
  const base = { version: 1, target: 'private-a', sample: 'a'.repeat(64), time: '2026-09-30T01:00:00Z' };
  const pending = aggregateEvents([{ ...base, phase: 'attempt', result: 'unknown' }], ['private-a']);
  expect(pending.counts).toMatchObject({ attempted: 1, confirmed: 0, unknown: 1 });
  const complete = aggregateEvents([{ ...base, phase: 'attempt', result: 'unknown' }, { ...base, phase: 'result', result: 'confirmed', latencyMs: 50, token: 'must-not-leak', response: 'chat contents', user_id: '123' }], ['private-a']);
  expect(complete.counts).toMatchObject({ attempted: 1, confirmed: 1, unknown: 0 });
  expect(JSON.stringify(complete)).not.toMatch(/must-not-leak|chat contents|user_id/);
});
it('rejects evidence outside the target whitelist', () => {
  expect(() => aggregateEvents([{ version: 1, target: 'other', sample: 'a'.repeat(64), time: new Date().toISOString(), result: 'confirmed' }], ['private-a'])).toThrow();
});
const startedAt = '2026-09-30T00:00:00Z';
const finishedAt = '2026-10-01T00:00:00Z';
function assess(aggregate: any, operators: any[] = [], overrides: any = {}) { return assessScenarios({ aggregate, operators, targets: policy.targets, startedAt, finishedAt, durationRequestedMs: 86400000, interrupted: false, resourceSamples: [], ...overrides }); }
it('native quote/media/recall requires later visible evidence for each exercised target', () => {
  const targets = [policy.targets[0], { ...policy.targets[0], alias: 'private-b', endpoint: 'second' }];
  for (const [scenario, action] of [['quote-roundtrip', 'reply-quote'], ['media-roundtrip', 'reply-image'], ['recall', 'reply-recall']]) {
    const evidence = targets.map(target => ({ action, phase: 'result', result: 'confirmed', target: target.alias, time: startedAt }));
    const result = (operators: any[]) => assess({ counts: {}, evidence }, operators, { targets }).find(item => item.name === scenario)?.status;
    const visible = targets.map(target => ({ scenario, phase: 'observation', status: 'pass', target: target.alias, time: finishedAt, evidenceLabel: 'visible-screenshot' }));
    expect(result([])).toBe('blocked');
    expect(result(visible.slice(0, 1))).toBe('blocked');
    expect(result(visible.map(item => ({ ...item, target: 'another-platform-target' })))).toBe('blocked');
    expect(result(visible.map(item => ({ ...item, time: '2026-09-29T00:00:00Z' })))).toBe('blocked');
    expect(result(visible.map(item => ({ ...item, evidenceLabel: '' })))).toBe('blocked');
    expect(result(visible)).toBe('pass');
    expect(result([...visible, { ...visible[0], status: 'fail' }])).toBe('fail');
    expect(assess({ counts: {}, evidence: [...evidence, { ...evidence[0], result: 'unknown' }] }, visible, { targets }).find(item => item.name === scenario)?.status).toBe('fail');
  }
});
it('operator pass cannot erase a failed or unknown platform probe', () => {
  for (const result of ['failed', 'unknown']) {
    const aggregate = { counts: { failed: result === 'failed' ? 1 : 0, unknown: result === 'unknown' ? 1 : 0 }, evidence: [{ action: 'reply-text', phase: 'result', result, target: 'private-a', time: startedAt }] };
    const scenarios = assess(aggregate, [{ scenario: 'text-roundtrip', phase: 'observation', status: 'pass', evidenceLabel: 'receipt' }]);
    expect(scenarios.find(s => s.name === 'text-roundtrip')?.status).toBe('fail');
  }
});
it('two conversation aliases on one account cannot pass account isolation', () => {
  const targets = [{ ...policy.targets[0] }, { ...policy.targets[0], alias: 'group-a', id: '456', kind: 'group' }];
  const evidence = targets.map(t => ({ action: 'account-marker', phase: 'result', result: 'confirmed', target: t.alias, time: startedAt }));
  expect(assess({ counts: {}, evidence }, [{ scenario: 'account-isolation', phase: 'observation', status: 'pass' }], { targets }).find(s => s.name === 'account-isolation')?.status).toBe('blocked');
});
it('elapsed time or operator pass alone cannot certify an idle or unobserved soak', () => {
  expect(assess({ counts: {}, evidence: [] }, [{ scenario: 'soak', phase: 'observation', status: 'pass' }], { soak: { minConfirmed: 100, maxGapMs: 60000, maxRssGrowthBytes: 1048576 } }).find(s => s.name === 'soak')?.status).toBe('blocked');
});
it('pending attempts without terminal evidence keep scenario failure despite an operator pass', () => {
  const aggregate = aggregateEvents([{ version: 1, phase: 'attempt', action: 'reply-text', target: 'private-a', sample: 'a'.repeat(64), time: startedAt, result: 'unknown' }], ['private-a']);
  expect(assess(aggregate, [{ scenario: 'text-roundtrip', phase: 'observation', status: 'pass' }]).find(s => s.name === 'text-roundtrip')?.status).toBe('fail');
});
it('manual recovery/HMR/restart claims need actual post-stage probes and identity changes', () => {
  const aggregate = { counts: {}, evidence: [{ action: 'reply-text', phase: 'result', result: 'confirmed', target: 'private-a', time: startedAt, generation: 1, pid: 42 }] };
  for (const scenario of ['network-recovery', 'hot-reload', 'production-restart']) {
    expect(assess(aggregate, [{ scenario, phase: 'end', status: 'pass', target: 'private-a', time: finishedAt }]).find(s => s.name === scenario)?.status).toBe('blocked');
  }
});
it('evidence cannot smuggle arbitrary action/state strings into a sanitized report', () => {
  expect(() => aggregateEvents([{ version: 1, action: 'secret-token', target: 'private-a', sample: 'a'.repeat(64), time: startedAt, result: 'confirmed' }], ['private-a'])).toThrow();
});
it('CLI observation writes exclusive sanitized metadata with a genuine installed-package lookup', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { spawn } = await import('node:child_process');
  const project = await mkdtemp(path.join(tmpdir(), 'platform-report-test-'));
  try {
    const adapter = path.join(project, 'node_modules/@zhin.js/adapter-telegram');
    await mkdir(adapter, { recursive: true });
    await writeFile(path.join(project, 'package.json'), '{"type":"module","zhin":{"plugins":[{"instanceKey":"telegram","package":"@zhin.js/adapter-telegram"}]}}');
    await writeFile(path.join(project, 'zhin.config.yml'), 'plugins:\n  telegram:\n    polling: true\n    endpoints:\n      - id: test-bot\n');
    await writeFile(path.join(adapter, 'package.json'), '{"name":"@zhin.js/adapter-telegram","version":"1.2.3","main":"index.js"}');
    await writeFile(path.join(adapter, 'index.js'), '');
    const localPolicy = { ...policy, eventsPath: path.join(project, 'events.jsonl') };
    const policyFile = path.join(project, 'policy.json'); const reportFile = path.join(project, 'report.json');
    await writeFile(policyFile, JSON.stringify(localPolicy));
    const child = spawn(process.execPath, ['scripts/platform-acceptance/run.mjs', '--project', project, '--policy', policyFile, '--report', reportFile, '--duration', '1s'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const complete = new Promise<number | null>(resolve => child.once('exit', resolve));
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.stdout.on('data', data => { output += String(data); if (output.includes('Observing')) resolve(); });
    });
    await writeFile(localPolicy.eventsPath, JSON.stringify({ version: 1, phase: 'result', action: 'reply-text', target: 'private-a', sample: 'a'.repeat(64), time: new Date().toISOString(), result: 'confirmed', token: 'secret', chat: 'private-content' }) + '\n');
    expect(await complete).toBe(0);
    const report = JSON.parse(await readFile(reportFile, 'utf8'));
    expect(report.package).toEqual({ name: '@zhin.js/adapter-telegram', version: '1.2.3' });
    expect(report.scenarios.find((s: any) => s.name === 'text-roundtrip').status).toBe('pass');
    expect(JSON.stringify(report)).not.toMatch(/secret|private-content/);
    expect(report.scenarios.find((s: any) => s.name === 'soak').status).toBe('blocked');
    await writeFile(policyFile, JSON.stringify({ ...localPolicy, platform: 'napcat', mode: 'ws' }));
    const wrongPlatform = spawn(process.execPath, ['scripts/platform-acceptance/run.mjs', '--project', project, '--policy', policyFile, '--report', path.join(project, 'incorrect-report.json'), '--duration', '1s'], { cwd: process.cwd(), stdio: 'ignore' });
    expect(await new Promise(resolve => wrongPlatform.once('exit', resolve))).toBe(1);
  } finally { await rm(project, { recursive: true, force: true }); }
});
it('unsupported completion preserves the attempted budget without fabricating confirmation', () => {
  const base = { version: 1, target: 'private-a', sample: 'a'.repeat(64), time: startedAt, action: 'reply-recall' };
  const result = aggregateEvents([{ ...base, phase: 'attempt', result: 'unknown' }, { ...base, phase: 'result', result: 'unsupported' }], ['private-a']);
  expect(result.counts).toMatchObject({ attempted: 1, unsupported: 1, confirmed: 0, unknown: 0 });
});
it('accepts explicit bridge provenance and rejects empty bridge identity', () => {
  expect(validatePolicy({ ...policy, platform: 'napcat', mode: 'ws', bridge: { name: 'NapCat', version: '4.0.0' } }).bridge.version).toBe('4.0.0');
  expect(() => validatePolicy({ ...policy, bridge: { name: 'NapCat', version: ' ' } })).toThrow();
});
const stageTimes = ['2026-09-30T00:00:00Z', '2026-09-30T00:00:01Z', '2026-09-30T00:00:02Z', '2026-09-30T00:00:03Z', '2026-09-30T00:00:04Z'];
function stageOperators(scenario: string) { return [{ scenario, phase: 'begin', status: 'blocked', target: 'private-a', time: stageTimes[1] }, { scenario, phase: 'end', status: 'pass', target: 'private-a', time: stageTimes[3] }]; }
function stageEvidence(result?: string) { return [{ action: 'reply-text', phase: 'result', result: 'confirmed', target: 'private-a', time: stageTimes[0], generation: 1, pid: 10 }, ...(result ? [{ action: 'reply-text', phase: 'result', result, target: 'private-a', time: stageTimes[2], generation: 1, pid: 10 }] : []), { action: 'reply-text', phase: 'result', result: 'confirmed', target: 'private-a', time: stageTimes[4], generation: 2, pid: 20 }]; }
it('HMR and restart cannot erase stage-window unknown or failed outcomes', () => {
  for (const scenario of ['hot-reload', 'production-restart']) for (const result of ['unknown', 'failed']) expect(assess({ counts: {}, evidence: stageEvidence(result) }, stageOperators(scenario)).find(s => s.name === scenario)?.status).toBe('fail');
});
it('HMR and restart require same-target pre-begin baseline and post-end changed identity', () => {
  for (const scenario of ['hot-reload', 'production-restart']) {
    expect(assess({ counts: {}, evidence: stageEvidence() }, stageOperators(scenario)).find(s => s.name === scenario)?.status).toBe('pass');
    const wrongTarget = stageEvidence().map((item, index) => index === 0 ? { ...item, target: 'other-account' } : item);
    expect(assess({ counts: {}, evidence: wrongTarget }, stageOperators(scenario)).find(s => s.name === scenario)?.status).toBe('blocked');
  }
});
it('operator-only generic passes remain blocked without matching probe evidence', () => {
  for (const scenario of ['duplicate-delivery', 'send-unknown', 'rate-limit', 'permission-denied']) expect(assess({ counts: {}, evidence: [] }, [{ scenario, phase: 'observation', status: 'pass', target: 'private-a', time: stageTimes[4] }]).find(s => s.name === scenario)?.status).toBe('blocked');
});
it('send unknown needs explicit reconciliation and retains its unknown outcome', () => {
  const aggregate = { counts: { unknown: 1 }, evidence: [{ phase: 'unresolved', result: 'unknown', target: 'private-a', time: stageTimes[2] }] };
  const observation = { scenario: 'send-unknown', phase: 'observation', status: 'pass', target: 'private-a', time: stageTimes[4] };
  expect(assess(aggregate, [observation]).find(s => s.name === 'send-unknown')?.status).toBe('blocked');
  expect(assess(aggregate, [{ ...observation, reconciliation: 'accepted' }]).find(s => s.name === 'send-unknown')?.status).toBe('pass');
  expect(aggregate.counts.unknown).toBe(1);
});
it('expected known fault-window rejection is distinct from an unknown or post-restoration failure', () => {
  for (const scenario of ['network-recovery', 'rate-limit', 'permission-denied']) {
    expect(assess({ counts: {}, evidence: stageEvidence('failed') }, stageOperators(scenario)).find(s => s.name === scenario)?.status).toBe('pass');
    expect(assess({ counts: {}, evidence: stageEvidence('unknown') }, stageOperators(scenario)).find(s => s.name === scenario)?.status).toBe('fail');
  }
});
it('soak fails on operator failure and blocks unrelated PID, missing coverage or cross-PID samples', () => {
  const resources = Array.from({ length: 2881 }, (_, index) => ({ time: new Date(Date.parse(startedAt) + index * 30000).toISOString(), rssBytes: 1000, pid: 10 }));
  const evidence = [{ result: 'confirmed', pid: 10, target: 'private-a', time: startedAt }, { result: 'confirmed', pid: 10, target: 'private-a', time: finishedAt }];
  const aggregate = { counts: {}, evidence };
  const options = { resourceSamples: resources, soak: { minConfirmed: 2, maxGapMs: 86400000, maxRssGrowthBytes: 1000 } };
  const pass = { scenario: 'soak', phase: 'observation', status: 'pass', target: 'private-a' };
  expect(assess(aggregate, [pass], options).find(s => s.name === 'soak')?.status).toBe('pass');
  expect(assess(aggregate, [{ ...pass, status: 'fail' }, pass], options).find(s => s.name === 'soak')?.status).toBe('fail');
  expect(assess(aggregate, [pass], { ...options, resourceSamples: resources.map(item => ({ ...item, pid: 999 })) }).find(s => s.name === 'soak')?.status).toBe('blocked');
  expect(assess(aggregate, [pass], { ...options, resourceSamples: resources.slice(0, -5) }).find(s => s.name === 'soak')?.status).toBe('blocked');
  expect(assess({ ...aggregate, evidence: [evidence[0], { ...evidence[1], pid: 20 }] }, [pass], options).find(s => s.name === 'soak')?.status).toBe('blocked');
});
it('platform manifest checks accept existing string/object implicit keys and reject another platform', () => {
  expect(manifestAdapterMatches('@zhin.js/adapter-telegram', 'telegram', '@zhin.js/adapter-telegram')).toBe(true);
  expect(manifestAdapterMatches({ package: '@zhin.js/adapter-telegram' }, 'telegram', '@zhin.js/adapter-telegram')).toBe(true);
  expect(manifestAdapterMatches({ package: '@zhin.js/adapter-telegram', instanceKey: 'tg-test' }, 'tg-test', '@zhin.js/adapter-telegram')).toBe(true);
  expect(manifestAdapterMatches('@zhin.js/adapter-napcat', 'napcat', '@zhin.js/adapter-telegram')).toBe(false);
});

it('requires visible evidence for markdown/share and a real callback for buttons', () => {
  for (const [scenario, action] of [['markdown-roundtrip', 'reply-markdown'], ['share-roundtrip', 'reply-share'], ['button-roundtrip', 'reply-button']]) {
    expect(validatePolicy({ ...policy, actions: [action] }).actions).toEqual([action]);
    const event = { version: 1, action, phase: 'result', result: 'confirmed', target: 'private-a', sample: 'd'.repeat(64), time: startedAt, callbackObserved: scenario === 'button-roundtrip' };
    const aggregate = aggregateEvents([event], ['private-a']);
    const visible = [{ scenario, phase: 'observation', status: 'pass', target: 'private-a', time: finishedAt, evidenceLabel: 'visible-client' }];
    expect(assess(aggregate).find(item => item.name === scenario)?.status).toBe('blocked');
    expect(assess(aggregate, visible).find(item => item.name === scenario)?.status).toBe('pass');
    if (scenario === 'button-roundtrip') {
      const noClick = aggregateEvents([{ ...event, callbackObserved: false }], ['private-a']);
      expect(assess(noClick, visible).find(item => item.name === scenario)?.status).toBe('blocked');
    }
  }
});

it('requires retained visible account markers for every exercised account after their confirmed receipt', () => {
  const targets = [{ ...policy.targets[0] }, { ...policy.targets[0], alias: 'private-b', endpoint: 'test-bot-b' }];
  const evidence = targets.map((target, index) => ({ action: 'account-marker', phase: 'result', result: 'confirmed', sample: String(index).repeat(64), target: target.alias, time: startedAt }));
  const result = (operators: any[]) => assess({ counts: {}, evidence }, operators, { targets }).find(s => s.name === 'account-isolation')?.status;
  const visible = targets.map(target => ({ scenario: 'account-isolation', phase: 'observation', status: 'pass', target: target.alias, time: finishedAt, evidenceLabel: 'account-markers-screenshot' }));
  expect(result(visible.slice(0, 1))).toBe('blocked');
  expect(result(visible.map(item => ({ ...item, evidenceLabel: '' })))).toBe('blocked');
  expect(result(visible.map(item => ({ ...item, time: '2026-09-28T00:00:00Z' })))).toBe('blocked');
  expect(result(visible)).toBe('pass');
});
it('duplicate evidence cannot borrow another account, action or earlier observation to pass', () => {
  const targets = [{ ...policy.targets[0] }, { ...policy.targets[0], alias: 'private-b', endpoint: 'test-bot-b' }];
  const confirmed = { sample: 'a'.repeat(64), target: 'private-a', action: 'reply-text', result: 'confirmed', phase: 'result', time: startedAt };
  const blocked = { ...confirmed, result: 'blocked', time: finishedAt };
  const visible = targets.map(target => ({ scenario: 'duplicate-delivery', phase: 'observation', status: 'pass', target: target.alias, time: finishedAt, evidenceLabel: 'duplicate-visible-count' }));
  const result = (evidence: any[], operators = visible) => assess({ counts: {}, evidence }, operators, { targets }).find(s => s.name === 'duplicate-delivery')?.status;
  expect(result([confirmed, { ...blocked, target: 'private-b' }])).toBe('blocked');
  expect(result([confirmed, { ...blocked, action: 'reply-image' }])).toBe('blocked');
  expect(result([confirmed, blocked], visible.map(item => ({ ...item, time: startedAt })))).toBe('blocked');
  expect(result([confirmed, blocked])).toBe('pass');
});
it('sample rebinding cannot overwrite an unknown account result with another account confirmation', () => {
  const first = { version: 1, sample: 'a'.repeat(64), target: 'private-a', action: 'reply-text', phase: 'result', result: 'unknown', time: startedAt };
  expect(() => aggregateEvents([first, { ...first, target: 'private-b', result: 'confirmed' }], ['private-a', 'private-b'])).toThrow('cannot change target');
  expect(() => aggregateEvents([first, { ...first, action: 'reply-image', result: 'confirmed' }], ['private-a'])).toThrow('cannot change target');
  expect(aggregateEvents([{ ...first, result: 'confirmed' }, { ...first, result: 'blocked' }], ['private-a']).counts).toMatchObject({ confirmed: 1, blocked: 1, duplicate: 1 });
});
