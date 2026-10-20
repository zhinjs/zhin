import type { QuietHoursWindow } from '../types.js';

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export interface ScatterSlotOptions {
  quietHours?: QuietHoursWindow[];
  minGapMinutes?: number;
}

export function parseTimeOfDay(value: string): number {
  const match = TIME_RE.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid time: ${value}`);
  }
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const second = match[3] ? parseInt(match[3], 10) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Invalid time: ${value}`);
  }
  return hour * 3600 + minute * 60 + second;
}

export function seedFrom(jobId: string, dateKey: string): number {
  let hash = 2166136261;
  const input = `${jobId}:${dateKey}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isSecInQuietHours(sec: number, startSec: number, endSec: number): boolean {
  if (startSec <= endSec) {
    return sec >= startSec && sec <= endSec;
  }
  return sec >= startSec || sec <= endSec;
}

export function buildEligiblePool(
  windowStartSec: number,
  windowEndSec: number,
  quietHours?: QuietHoursWindow[],
): number[] {
  const quietRanges = (quietHours ?? []).map((q) => ({
    start: parseTimeOfDay(q.start),
    end: parseTimeOfDay(q.end),
  }));

  const pool: number[] = [];
  for (let sec = windowStartSec; sec <= windowEndSec; sec++) {
    const blocked = quietRanges.some((range) => isSecInQuietHours(sec, range.start, range.end));
    if (!blocked) {
      pool.push(sec);
    }
  }
  return pool;
}

function satisfiesMinGap(selected: number[], candidate: number, minGapSec: number): boolean {
  if (minGapSec <= 0) {
    return true;
  }
  for (const slot of selected) {
    if (Math.abs(candidate - slot) < minGapSec) {
      return false;
    }
  }
  return true;
}

export function generateDailySlots(
  jobId: string,
  dateKey: string,
  windowStartSec: number,
  windowEndSec: number,
  count: number,
  options: ScatterSlotOptions = {},
): number[] {
  const pool = buildEligiblePool(windowStartSec, windowEndSec, options.quietHours);
  if (count > pool.length) {
    throw new Error('count exceeds window capacity');
  }

  const minGapSec = (options.minGapMinutes ?? 0) * 60;
  const rand = mulberry32(seedFrom(jobId, dateKey));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected: number[] = [];
  for (const candidate of shuffled) {
    if (!satisfiesMinGap(selected, candidate, minGapSec)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= count) {
      break;
    }
  }

  if (selected.length < count) {
    throw new Error('count exceeds window capacity with minGap/quietHours');
  }

  return selected.sort((a, b) => a - b);
}

export function canFitScatterCount(
  jobId: string,
  dateKey: string,
  windowStartSec: number,
  windowEndSec: number,
  count: number,
  options: ScatterSlotOptions = {},
): boolean {
  try {
    generateDailySlots(jobId, dateKey, windowStartSec, windowEndSec, count, options);
    return true;
  } catch {
    return false;
  }
}
