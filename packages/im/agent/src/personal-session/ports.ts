import type { PersonalSessionIdentity, PersonalSessionState } from './types.js';

export type PersonalSessionWriteResult =
  | Readonly<{ kind: 'updated'; state: PersonalSessionState }>
  | Readonly<{ kind: 'conflict'; actualRevision: number }>;

/** Implementations must commit the revision comparison and write atomically. */
export interface PersonalSessionRepository {
  read(identity: PersonalSessionIdentity): Promise<PersonalSessionState | undefined>;
  /** Missing state has revision zero. Errors must propagate, never become absence. */
  compareAndSet(expectedRevision: number, next: PersonalSessionState): Promise<PersonalSessionWriteResult>;
}
