/** A required Turn fact could not be committed to the durable Journal. */
export class TurnJournalCommitError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'TurnJournalCommitError';
  }
}
