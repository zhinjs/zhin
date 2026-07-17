import type { RuntimeConfigDocument } from './config-composer.js';
import type { ConfigPatch } from './config-patch-planner.js';

export interface ConfigDocumentSnapshot {
  readonly document: RuntimeConfigDocument;
  readonly revision: string;
}

/** A prepared write is inert until the generation handoff activates it. */
export interface PreparedConfigDocument {
  readonly document: RuntimeConfigDocument;
  commit(): Promise<ConfigDocumentSnapshot>;
  rollback(): Promise<void>;
}

export interface ConfigDocumentPort {
  read(): Promise<ConfigDocumentSnapshot>;
  prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument>;
}

export class ConfigDocumentDivergenceError extends Error {
  constructor() {
    super('ConfigDocument adapter candidate differs from the validated Runtime candidate');
    this.name = 'ConfigDocumentDivergenceError';
  }
}
