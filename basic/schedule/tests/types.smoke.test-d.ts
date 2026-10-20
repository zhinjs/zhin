import { CalendarScheduler, cron, resolveSolarJob, getNextRun } from '../src/index.js';

const scheduler = new CalendarScheduler({ timezone: 'Asia/Shanghai' });

scheduler.solar(cron.at(9), () => {});
scheduler.solar(cron.everyMinutes(10), () => {}, 'daily', { id: 'job-1' });
scheduler.freeDay(cron.at(9), () => {});
scheduler.workday('0 0 9 * * *', () => {});
scheduler.scatter({ window: { start: '09:00', end: '22:00' }, count: 3, on: 'workday' }, () => {});
scheduler.holiday('0 0 9 * * *', () => {});

const lunarJob = scheduler.lunar('0 0 0 1 1 *', () => {});
if (lunarJob.kind === 'lunar') {
  lunarJob.kind satisfies 'lunar';
}

const resolved = resolveSolarJob('0 0 9 * * 1', 'Asia/Shanghai');
if (resolved.kind === 'solar') {
  resolved.cron satisfies string;
}

const next = getNextRun(resolved, new Date());
next satisfies Date | null;

scheduler.stop();

export {};
