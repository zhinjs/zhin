#!/usr/bin/env node
/** Observes real Zhin reply probes. No credentials, platform traffic or account login is performed by this process. */
import { parse as parseYaml } from 'yaml';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { platform, release } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePolicy, durationMs, aggregateEvents, SCENARIOS, assessScenarios, manifestAdapterMatches, configuredMode } from './report.mjs';
const { values } = parseArgs({ options: { project: { type: 'string' }, policy: { type: 'string' }, report: { type: 'string' }, duration: { type: 'string', default: '30s' }, prepare: { type: 'boolean', default: false }, pid: { type: 'string' } } });
if (!values.project || !values.policy) throw new Error('--project and --policy required');
const project = path.resolve(values.project);
const projectManifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
const policy = validatePolicy(JSON.parse(await readFile(path.resolve(values.policy), 'utf8')));
let projectConfig;
try { projectConfig = parseYaml(await readFile(path.join(project, 'zhin.config.yml'), 'utf8')); } catch { throw new Error('Test project configuration unavailable or invalid'); }
for (const target of policy.targets) {
  const instanceKey = target.adapter.split('/').at(-1);
  if (!projectManifest.zhin?.plugins?.some(entry => manifestAdapterMatches(entry, instanceKey, `@zhin.js/adapter-${policy.platform}`))) throw new Error('Policy platform differs from the declared adapter plugin instance');
  const instance = projectConfig.plugins?.[target.adapter.split('/').at(-1)];
  const endpoint = instance?.endpoints?.find(entry => String(entry.id) === target.endpoint);
  if (!instance || !endpoint) throw new Error('Policy target does not match a configured endpoint');
  const merged = { ...instance, ...endpoint };
  const actualMode = configuredMode(policy.platform, merged);
  if (policy.mode !== actualMode) throw new Error('Policy transport mode differs from the project configuration');
}
if (values.prepare) {
  const destination = path.join(project, 'commands/acceptance');
  await mkdir(destination, { recursive: true });
  await copyFile(fileURLToPath(new URL('./probe-command.ts', import.meta.url)), path.join(destination, 'index.ts'), constants.COPYFILE_EXCL);
  console.log('Probe installed. Start the test project with ZHIN_ACCEPTANCE_POLICY pointing at your local policy file.');
  process.exit(0);
}
if (!values.report) throw new Error('--report required; use a new local output path');
const duration = durationMs(values.duration);
const require = createRequire(path.join(project, 'package.json'));
const packageName = `@zhin.js/adapter-${policy.platform}`;
function installedVersion(name) {
  try {
    let resolved;
    try { resolved = require.resolve(name); } catch { resolved = createRequire(require.resolve(packageName)).resolve(name); }
    let directory = path.dirname(resolved);
    while (directory !== path.dirname(directory)) {
      try { const manifest = JSON.parse(execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', path.join(directory, 'package.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); if (manifest.name === name) return manifest.version; } catch {}
      directory = path.dirname(directory);
    }
  } catch {}
  throw new Error(`Installed package metadata unavailable: ${name}`);
}
const version = installedVersion(packageName);
const sdkNames = { discord: 'discord.js', slack: '@slack/web-api', kook: 'kook-client', email: 'nodemailer', qq: 'qq-official-bot' };
const sdkName = sdkNames[policy.platform];
const sdk = sdkName ? { name: sdkName, version: installedVersion(sdkName) } : { name: policy.platform === 'telegram' ? 'Telegram Bot API (native fetch)' : 'OneBot11 protocol (native adapter)', version: null };
const git = args => { try { return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const resourceSamples = [];
const pid = values.pid ? Number(values.pid) : undefined;
if (pid !== undefined && (!Number.isInteger(pid) || pid <= 0)) throw new Error('--pid must identify the test runtime process');
const startedAt = new Date().toISOString();
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; }); process.once('SIGTERM', () => { interrupted = true; });
const deadline = Date.now() + duration;
console.log(`Observing ${policy.platform}/${policy.mode} for ${values.duration}. Send /acceptance probe:<unique 8-64 character id> only from allowlisted conversations.`);
let nextResourceAt = 0;
while (!interrupted && Date.now() < deadline) {
  if (pid && Date.now() >= nextResourceAt) {
    try { const rssKiB = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); if (rssKiB > 0) resourceSamples.push({ time: new Date().toISOString(), rssBytes: rssKiB * 1024, pid }); } catch {}
    nextResourceAt = Date.now() + 30000;
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(1000, deadline - Date.now()))));
}
let lines = '';
try { lines = await readFile(policy.eventsPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const events = lines.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(event => Date.parse(event.time) >= Date.parse(startedAt));
if (events.some(event => event.platform !== undefined && event.platform !== policy.platform)) throw new Error('Observed adapter identity differs from policy platform');
const aggregate = aggregateEvents(events, policy.targets.map(target => target.alias));
let operators = [];
try { operators = (await readFile(`${policy.eventsPath}.operator.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(item => Date.parse(item.time) >= Date.parse(startedAt)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const item of operators) { if (item.version !== 1 || item.source !== 'operator' || !Number.isFinite(Date.parse(item.time)) || (item.reconciliation != null && !['accepted', 'not-delivered', 'unresolved'].includes(item.reconciliation)) || !SCENARIOS.includes(item.scenario) || !['pass', 'fail', 'blocked', 'unsupported'].includes(item.status) || !['begin', 'end', 'observation'].includes(item.phase) || !policy.targets.some(t => t.alias === item.target)) throw new Error('Invalid operator evidence'); }
for (const [index, item] of operators.entries()) {
  if (!path.isAbsolute(item.evidencePath) || !(await stat(item.evidencePath)).isFile() || (await readFile(item.evidencePath)).length === 0) throw new Error('Operator evidence must be a readable nonempty local file');
  item.evidenceLabel = `operator-evidence-${index + 1}`;
}
const finishedAt = new Date().toISOString();
const scenarioResults = assessScenarios({ aggregate, operators, targets: policy.targets, startedAt, finishedAt, durationRequestedMs: duration, interrupted, resourceSamples: resourceSamples.length ? resourceSamples : aggregate.resourceSamples, soak: policy.soak });
const recoveries = operators.filter(item => item.scenario === 'network-recovery' && item.phase === 'end').map(end => {
  const next = aggregate.evidence.find(item => item.result === 'confirmed' && item.target === end.target && Date.parse(item.time) >= Date.parse(end.time));
  return { target: end.target, restoredAt: end.time, firstConfirmedAt: next?.time ?? null, restorationMs: next ? Date.parse(next.time) - Date.parse(end.time) : null };
});
const rss = resourceSamples.length ? resourceSamples : aggregate.resourceSamples;
const resourceTrend = { samples: rss.length, firstRssBytes: rss[0]?.rssBytes ?? null, lastRssBytes: rss.at(-1)?.rssBytes ?? null, deltaRssBytes: rss.length ? rss.at(-1).rssBytes - rss[0].rssBytes : null, peakRssBytes: rss.length ? Math.max(...rss.map(s => s.rssBytes)) : null };
const report = { version: 1, kind: 'live-reply-probe-observation', commit: git(['rev-parse', 'HEAD']), worktree: { dirty: Boolean(git(['status', '--porcelain'])), available: git(['rev-parse', '--is-inside-work-tree']) === 'true' }, platform: policy.platform, mode: policy.mode, modeSource: 'operator-configured', modeConfigurationChecked: true, package: { name: packageName, version }, sdk, bridge: policy.bridge ? { name: policy.bridge.name.trim(), version: policy.bridge.version.trim(), source: 'operator-configured' } : null, certification: { status: 'blocked', missingBridgeVersion: ['onebot11', 'napcat'].includes(policy.platform) && !policy.bridge, limitations: ['This observation report does not automatically certify or promote a platform.', 'Git commit identifies source, not the SHA256 of a packed release artifact.'] }, node: process.version, os: `${platform()} ${release()}`, startedAt, finishedAt, durationRequestedMs: duration, interrupted, limits: { actions: policy.actions, minIntervalMs: policy.minIntervalMs, maxSends: policy.maxSends, targets: policy.targets.map(t => t.alias) }, scenarios: scenarioResults, recoveries, operatorEvidence: operators.map(item => ({ scenario: item.scenario, status: item.status, phase: item.phase, reconciliation: item.reconciliation ?? null, target: item.target, time: item.time, evidenceLabel: item.evidenceLabel })), resourceTrend, ...aggregate, processResourceSamples: resourceSamples, evidenceFiles: [{ label: 'probe-events', path: policy.eventsPath }, ...operators.map(item => ({ label: item.evidenceLabel, path: item.evidencePath }))], limitations: [...(['onebot11', 'napcat'].includes(policy.platform) && !policy.bridge ? ['Bridge version missing: certification remains blocked; fill policy.bridge before the bridge acceptance run.'] : []), 'Platform receipt confirms API acceptance, not recipient visibility.', 'Soak stays blocked until recovery, traffic density and resource criteria are separately reviewed.', 'Operator evidence is labelled separately; pass records must include retained local evidence and never imply unexecuted scenarios.'] };
await writeFile(path.resolve(values.report), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Wrote sanitized report: ${path.resolve(values.report)}`);
if (report.scenarios[0].status !== 'pass') process.exitCode = 1;
