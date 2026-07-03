import type { ScatterJobPayload, ScatterRunState } from '../types.js';
import { formatDateKey } from './timezone.js';

export const EMPTY_SCATTER_STATE: ScatterRunState = { dateKey: '', firedCount: 0 };

export function getScatterState(payload: unknown): ScatterRunState {
  if (payload && typeof payload === 'object' && 'scatter' in payload) {
    const scatter = (payload as ScatterJobPayload).scatter;
    if (
      scatter &&
      typeof scatter.dateKey === 'string' &&
      typeof scatter.firedCount === 'number'
    ) {
      return scatter;
    }
  }
  return { ...EMPTY_SCATTER_STATE };
}

export function mergeScatterPayload(
  payload: unknown,
  state: ScatterRunState,
): ScatterJobPayload & Record<string, unknown> {
  const base =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  return { ...base, scatter: state };
}

export function setScatterState(dateKey: string, firedCount: number): ScatterRunState {
  return { dateKey, firedCount };
}

export function advanceScatterState(
  firedAt: Date,
  timezone: string,
  current: ScatterRunState,
): ScatterRunState {
  const dateKey = formatDateKey(firedAt, timezone);
  if (current.dateKey === dateKey) {
    return { dateKey, firedCount: current.firedCount + 1 };
  }
  return { dateKey, firedCount: 1 };
}
