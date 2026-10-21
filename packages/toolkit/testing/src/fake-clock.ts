import type { PluginId, ScheduleHost, ScheduleJobRegistration } from '@zhin.js/plugin-runtime';

/** Controllable wall clock. It never touches the real `Date` or timers. */
export class FakeClock {
  #now: number;
  readonly #listeners = new Set<(from: number, to: number) => Promise<void>>();

  constructor(start: number | Date = Date.UTC(2026, 0, 1, 0, 0, 0)) {
    this.#now = typeof start === 'number' ? start : start.getTime();
  }

  now(): number { return this.#now; }
  date(): Date { return new Date(this.#now); }

  /** Jump without firing anything (like setting the system time). */
  set(time: number | Date): void { this.#now = typeof time === 'number' ? time : time.getTime(); }

  /**
   * Move forward and run every cron job that became due, in time order.
   *
   * The clock always ends at the target time, even when a job throws. After a failure the error
   * is rethrown and the remaining jobs due inside the same window are NOT run (they are skipped, not deferred).
   */
  async advance(ms: number): Promise<void> {
    if (!(ms >= 0)) throw new RangeError('FakeClock.advance requires a non-negative duration');
    const from = this.#now;
    const to = from + ms;
    try {
      for (const listener of [...this.#listeners]) await listener(from, to);
    } finally {
      this.#now = to;
    }
  }

  /** @internal */
  onAdvance(listener: (from: number, to: number) => Promise<void>): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
}

type Field = ReadonlySet<number>;

function parseField(text: string, min: number, max: number): Field {
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const [range = '', stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new TypeError(`Invalid cron step: ${part}`);
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-');
      lo = Number(a);
      hi = b === undefined ? (stepText === undefined ? lo : max) : Number(b);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new TypeError(`Invalid cron field: ${text}`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** Six-field cron (`sec min hour day month weekday`, Sunday = 0) evaluated in local time. */
export function parseCron(cron: string): (date: Date) => boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 6) throw new TypeError(`Cron must have six fields: ${cron}`);
  const sec = parseField(parts[0]!, 0, 59);
  const min = parseField(parts[1]!, 0, 59);
  const hour = parseField(parts[2]!, 0, 23);
  const day = parseField(parts[3]!, 1, 31);
  const month = parseField(parts[4]!, 1, 12);
  const week = parseField(parts[5]!, 0, 7);
  return (d) => sec.has(d.getSeconds()) && min.has(d.getMinutes()) && hour.has(d.getHours())
    && day.has(d.getDate()) && month.has(d.getMonth() + 1)
    && (week.has(d.getDay()) || (d.getDay() === 0 && week.has(7)));
}

export interface FakeScheduledJob {
  readonly id: string;
  readonly cron: string;
  readonly description?: string;
  readonly owner?: PluginId;
}

interface Entry extends ScheduleJobRegistration { readonly matches: (d: Date) => boolean }

/**
 * In-memory process Schedule Host driven by a {@link FakeClock}. The harness wraps it with the real
 * `PluginScheduleHost` to get the exact facade plugins see.
 */
export class FakeScheduleRootHost implements ScheduleHost {
  readonly #jobs = new Set<Entry>();

  constructor(readonly clock: FakeClock) {
    clock.onAdvance(async (from, to) => {
      for (let t = Math.floor(from / 1000) * 1000 + 1000; t <= to; t += 1000) {
        const date = new Date(t);
        // A job firing at `t` must observe `t` (e.g. to decide what is due), not the advance() start.
        clock.set(t);
        for (const job of [...this.#jobs]) {
          if (this.#jobs.has(job) && job.isActive?.() !== false && job.matches(date)) await job.execute();
        }
      }
    });
  }

  register(job: ScheduleJobRegistration): () => void {
    const entry: Entry = Object.freeze({ ...job, matches: parseCron(job.cron) });
    this.#jobs.add(entry);
    return () => { this.#jobs.delete(entry); };
  }

  list(): readonly FakeScheduledJob[] {
    return [...this.#jobs].map(({ id, cron, description, owner }) =>
      ({ id, cron, ...(description === undefined ? {} : { description }), ...(owner === undefined ? {} : { owner }) }));
  }

  /** Run a registered job now, by its qualified id; rejects if it is not registered. */
  async trigger(id: string): Promise<void> {
    const job = [...this.#jobs].find(item => item.id === id);
    if (!job) throw new Error(`No scheduled job: ${id}`);
    await job.execute();
  }
}
