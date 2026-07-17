import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CommandStep, ProjectPlan } from './project-commands.js';

export type PublishStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PublishJournalStep {
  readonly id: string;
  readonly packageName: string;
  readonly version: string;
  readonly phase: CommandStep['phase'];
  readonly status: PublishStepStatus;
  readonly attempts: number;
  readonly error?: string;
}

export interface PublishJournal {
  readonly protocol: 1;
  readonly planId: string;
  readonly targetTag: string;
  readonly stagingTag: string;
  readonly state: 'active' | 'failed' | 'complete';
  readonly steps: readonly PublishJournalStep[];
}

export interface PublishJournalStore {
  read(): Promise<PublishJournal | undefined>;
  write(journal: PublishJournal): Promise<void>;
}

export class FilePublishJournalStore implements PublishJournalStore {
  constructor(readonly path: string) {}

  async read(): Promise<PublishJournal | undefined> {
    try {
      return validateJournal(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(journal: PublishJournal): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`);
    await rename(temporary, this.path);
  }
}

export function createPublishJournal(plan: ProjectPlan): PublishJournal {
  if (plan.kind !== 'publish' || plan.mode !== 'execute'
    || !plan.id || !plan.targetTag || !plan.stagingTag) {
    throw new TypeError('Publish journal requires an executable publish plan');
  }
  return Object.freeze({
    protocol: 1,
    planId: plan.id,
    targetTag: plan.targetTag,
    stagingTag: plan.stagingTag,
    state: 'active',
    steps: Object.freeze(plan.steps.map((step) => Object.freeze({
      id: step.id,
      packageName: step.packageName,
      version: requiredVersion(step),
      phase: step.phase,
      status: 'pending' as const,
      attempts: 0,
    }))),
  });
}

export function updateJournalStep(
  journal: PublishJournal,
  id: string,
  update: Partial<Pick<PublishJournalStep, 'status' | 'attempts' | 'error'>>,
  state: PublishJournal['state'] = journal.state,
): PublishJournal {
  let found = false;
  const steps = journal.steps.map((step) => {
    if (step.id !== id) return step;
    found = true;
    const next = { ...step, ...update };
    if (update.error === undefined) delete next.error;
    return Object.freeze(next);
  });
  if (!found) throw new Error(`Publish journal does not contain step ${id}`);
  return Object.freeze({ ...journal, state, steps: Object.freeze(steps) });
}

export function completeJournal(journal: PublishJournal): PublishJournal {
  if (journal.steps.some((step) => step.status !== 'completed')) {
    throw new Error('Cannot complete publish journal with unfinished steps');
  }
  return Object.freeze({ ...journal, state: 'complete' });
}

function validateJournal(value: unknown): PublishJournal {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid publish journal');
  const journal = value as Partial<PublishJournal>;
  if (journal.protocol !== 1 || !nonEmpty(journal.planId)
    || !nonEmpty(journal.targetTag) || !nonEmpty(journal.stagingTag)
    || !Array.isArray(journal.steps)
    || !['active', 'failed', 'complete'].includes(journal.state ?? '')) {
    throw new TypeError('Invalid publish journal');
  }
  const ids = new Set<string>();
  const steps = journal.steps.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new TypeError('Invalid publish journal step');
    const step = candidate as Partial<PublishJournalStep>;
    if (!nonEmpty(step.id) || ids.has(step.id)
      || !nonEmpty(step.packageName) || !nonEmpty(step.version)
      || !['publish', 'promote', 'cleanup'].includes(step.phase ?? '')
      || !['pending', 'running', 'completed', 'failed'].includes(step.status ?? '')
      || !Number.isInteger(step.attempts) || (step.attempts ?? -1) < 0
      || (step.error !== undefined && typeof step.error !== 'string')) {
      throw new TypeError('Invalid publish journal step');
    }
    ids.add(step.id);
    return Object.freeze({ ...step }) as PublishJournalStep;
  });
  return Object.freeze({ ...journal, steps: Object.freeze(steps) }) as PublishJournal;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function requiredVersion(step: CommandStep): string {
  if (!step.version) throw new TypeError(`Publish step ${step.id} has no package version`);
  return step.version;
}
