import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ADAPTERS, isAiEnabledInConfig } from '@zhin.js/scaffold-wizard';

export const ONBOARDING_STEPS = Object.freeze(['database', 'owner', 'ai', 'adapters'] as const);
export type OnboardingStep = typeof ONBOARDING_STEPS[number];
export type OnboardingStepStatus = 'pending' | 'done' | 'skipped';

/** `.zhin/onboarding.json` (ADR 0053 §4). */
export interface OnboardingState {
  readonly version: 1;
  readonly steps: Readonly<Record<OnboardingStep, OnboardingStepStatus>>;
  /** ISO timestamp set by `complete()`. */
  readonly completedAt?: string;
}

export const ONBOARDING_FILE = join('.zhin', 'onboarding.json');

export function emptyOnboardingState(): OnboardingState {
  return Object.freeze({
    version: 1,
    steps: Object.freeze({ database: 'pending', owner: 'pending', ai: 'pending', adapters: 'pending' }),
  });
}

const STATUSES: ReadonlySet<string> = new Set(['pending', 'done', 'skipped']);

/** Strict parse; anything malformed returns undefined (treated as a fresh state). */
export function parseOnboardingState(value: unknown): OnboardingState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as { version?: unknown; steps?: unknown; completedAt?: unknown };
  if (raw.version !== 1 || !raw.steps || typeof raw.steps !== 'object') return undefined;
  const steps = {} as Record<OnboardingStep, OnboardingStepStatus>;
  for (const step of ONBOARDING_STEPS) {
    const status = (raw.steps as Record<string, unknown>)[step];
    steps[step] = typeof status === 'string' && STATUSES.has(status) ? status as OnboardingStepStatus : 'pending';
  }
  const completedAt = typeof raw.completedAt === 'string' && !Number.isNaN(Date.parse(raw.completedAt)) ? raw.completedAt : undefined;
  return Object.freeze({ version: 1, steps: Object.freeze(steps), ...(completedAt ? { completedAt } : {}) });
}

/** Reads / atomically writes `.zhin/onboarding.json` (temp file + rename, mode 0600). */
export class OnboardingStateStore {
  readonly file: string;
  constructor(projectRoot: string, file = ONBOARDING_FILE) {
    this.file = resolve(projectRoot, file);
  }

  /** The stored state, or undefined when the file is absent or invalid. */
  async read(): Promise<OnboardingState | undefined> {
    let source: string;
    try { source = await readFile(this.file, 'utf8'); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
    try { return parseOnboardingState(JSON.parse(source)); }
    catch { return undefined; }
  }

  async write(state: OnboardingState): Promise<void> {
    const parsed = parseOnboardingState(state);
    if (!parsed) throw new Error('Invalid onboarding state');
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await chmod(temporary, 0o600);
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

const ADAPTER_PACKAGES: ReadonlySet<string> = new Set(ADAPTERS.map(adapter => adapter.package));

/** Steps an existing project has already configured (ADR 0053 §4 upgrade rule). */
export function detectConfiguredSteps(config: Readonly<Record<string, unknown>>): ReadonlySet<OnboardingStep> {
  const detected = new Set<OnboardingStep>();
  const database = config.database;
  if (database && typeof database === 'object' && !Array.isArray(database)
    && typeof (database as { dialect?: unknown }).dialect === 'string') detected.add('database');
  const plugins = config.plugins;
  const packages = plugins && typeof plugins === 'object' && !Array.isArray(plugins)
    ? Object.values(plugins as Record<string, unknown>) : [];
  if (packages.some(value => typeof value === 'string' && ADAPTER_PACKAGES.has(value))) detected.add('adapters');
  if (isAiEnabledInConfig(config)) detected.add('ai');
  return detected;
}

/** Pending steps become `done` when detected; `done` / `skipped` are never overridden. */
export function applyDetection(state: OnboardingState, detected: ReadonlySet<OnboardingStep>): OnboardingState {
  let changed = false;
  const steps = { ...state.steps };
  for (const step of detected) {
    if (steps[step] === 'pending') { steps[step] = 'done'; changed = true; }
  }
  return changed ? Object.freeze({ ...state, steps: Object.freeze(steps) }) : state;
}
