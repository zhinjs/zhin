#!/usr/bin/env node
import { simulateNextRuns } from '../dist/planning/simulate-runs.mjs';
import { resolveScatterJob, resolveWorkdayJob } from '../dist/resolve-job.mjs';
import { listScatterSlotsForDay } from '../dist/resolvers/scatter.mjs';

const args = process.argv.slice(2);
const kind = readArg('--kind') ?? 'scatter';
const jobId = readArg('--job-id') ?? 'demo-job';
const count = Number(readArg('-n') ?? '5');
const dateKey = readArg('--date') ?? '2024-09-23';

function readArg(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function fmt(date) {
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

if (kind === 'scatter') {
  const inputRaw = readArg('--input');
  const input = inputRaw
    ? JSON.parse(inputRaw)
    : { window: { start: '09:00', end: '22:00' }, count: 3, on: 'workday' };
  const job = resolveScatterJob(input, 'Asia/Shanghai');
  console.log(`Scatter slots on ${dateKey}:`);
  for (const slot of listScatterSlotsForDay(job, jobId, dateKey)) {
    console.log(' ', fmt(slot));
  }
  console.log('');
  console.log(`Next ${count} runs:`);
  for (const run of simulateNextRuns(job, count, {
    jobId,
    from: new Date('2024-09-23T08:00:00+08:00'),
  })) {
    console.log(' ', fmt(run));
  }
} else if (kind === 'workday') {
  const job = resolveWorkdayJob('0 0 9 * * *', 'Asia/Shanghai');
  for (const run of simulateNextRuns(job, count, { from: new Date() })) {
    console.log(fmt(run));
  }
} else {
  console.error(`Unsupported kind: ${kind}`);
  process.exit(1);
}
