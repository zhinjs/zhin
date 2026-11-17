/** Why a schedule run's model request failed (#1250 b40 schedule-failed-run-marked-ok). */
export interface ScheduleModelFailure {
  /** `network`, `server`, `timeout`, `no_response`, `auth`, ... or `unknown`. */
  readonly kind: string;
  readonly transient: boolean;
  /** Display name of the model service's account, when known. */
  readonly service?: string;
}

const TRANSIENT_MODEL_FAILURES: ReadonlySet<string> = new Set(['network', 'server', 'timeout', 'no_response']);

/** A model failure that a later retry may fix: the service was temporarily unavailable. */
export function isTransientModelFailure(kind: string): boolean {
  return TRANSIENT_MODEL_FAILURES.has(kind);
}
