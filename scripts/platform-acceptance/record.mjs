#!/usr/bin/env node
/** Record an operator's authorized fault/HMR/restart/visibility observation. */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readFile, appendFile, stat } from 'node:fs/promises';
import { validatePolicy, SCENARIOS } from './report.mjs';
const { values } = parseArgs({ options: { policy: { type: 'string' }, scenario: { type: 'string' }, status: { type: 'string' }, phase: { type: 'string' }, target: { type: 'string' }, evidence: { type: 'string' }, reconciliation: { type: 'string' } } });
if (!values.policy || !SCENARIOS.includes(values.scenario) || !['pass', 'fail', 'blocked', 'unsupported'].includes(values.status) || !['begin', 'end', 'observation'].includes(values.phase)) throw new Error('Required: --policy --scenario --status pass|fail|blocked|unsupported --phase begin|end|observation --target alias --evidence local-file');
if (values.reconciliation && !['accepted', 'not-delivered', 'unresolved'].includes(values.reconciliation)) throw new Error('Invalid reconciliation disposition');
const policy = validatePolicy(JSON.parse(await readFile(values.policy, 'utf8')));
if (!policy.targets.some(target => target.alias === values.target)) throw new Error('Target outside policy whitelist');
if (!values.evidence || !path.isAbsolute(values.evidence) || !(await stat(values.evidence)).isFile() || (await readFile(values.evidence)).length === 0) throw new Error('Existing local evidence file required');
await appendFile(`${policy.eventsPath}.operator.jsonl`, JSON.stringify({ version: 1, source: 'operator', scenario: values.scenario, status: values.status, phase: values.phase, reconciliation: values.reconciliation ?? null, target: values.target, time: new Date().toISOString(), evidencePath: values.evidence }) + '\n', { mode: 0o600 });
console.log('Operator evidence recorded; it will remain distinct from automated probe evidence.');
