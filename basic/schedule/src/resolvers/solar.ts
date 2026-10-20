import { matchesCron, parseCron } from '../parsers/cron.js';
import { planSolarNextRun } from '../planning/solar-planner.js';

export function getSolarNextRun(from: Date, cron: string, timezone: string): Date | null {
  return planSolarNextRun(from, cron, timezone);
}

export function isSolarDue(at: Date, cron: string, timezone: string): boolean {
  const fields = parseCron(cron);
  return matchesCron(fields, at, timezone);
}
