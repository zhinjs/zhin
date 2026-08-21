import {
  WorkroomJournalPayloadAuthorityUnavailableError,
  type WorkroomJournalPayloadPort,
} from '../workroom/journal.js';

export interface GenerationOwnedWorkroomJournalPayloadPort {
  readonly generation: number;
  readonly payloads: WorkroomJournalPayloadPort;
  activate(authority: WorkroomJournalPayloadPort): void;
}

/**
 * Root-only latch used to construct the durable Journal before the generation's
 * private data-governance runtime is ready. It never exposes that runtime,
 * repository or Vault and has no plaintext fallback.
 */
export function createGenerationOwnedWorkroomJournalPayloadPort(
  options: Readonly<{ generation: number; signal: AbortSignal }>,
): GenerationOwnedWorkroomJournalPayloadPort {
  if (!Number.isSafeInteger(options.generation) || options.generation <= 0) {
    throw new Error('Workroom Journal payload generation must be a positive integer');
  }
  let delegate: WorkroomJournalPayloadPort | undefined;
  const requireAuthority = (): WorkroomJournalPayloadPort => {
    options.signal.throwIfAborted();
    if (!delegate) throw new WorkroomJournalPayloadAuthorityUnavailableError();
    return delegate;
  };
  const payloads = Object.freeze<WorkroomJournalPayloadPort>({
    write: async input => {
      const result = await requireAuthority().write(input);
      options.signal.throwIfAborted();
      return result;
    },
    read: async input => {
      const result = await requireAuthority().read(input);
      options.signal.throwIfAborted();
      return result;
    },
    publish: async input => {
      const authority = requireAuthority();
      if (!authority.publish) throw new WorkroomJournalPayloadAuthorityUnavailableError();
      await authority.publish(input);
      options.signal.throwIfAborted();
    },
    prepare: async input => {
      const authority = requireAuthority();
      if (!authority.prepare) throw new WorkroomJournalPayloadAuthorityUnavailableError();
      await authority.prepare(input);
      options.signal.throwIfAborted();
    },
    abandon: async input => {
      const authority = requireAuthority();
      if (!authority.abandon) throw new WorkroomJournalPayloadAuthorityUnavailableError();
      await authority.abandon(input);
      options.signal.throwIfAborted();
    },
    reconcile: async input => {
      const authority = requireAuthority();
      if (!authority.reconcile) throw new WorkroomJournalPayloadAuthorityUnavailableError();
      await authority.reconcile(input);
      options.signal.throwIfAborted();
    },
  });
  return Object.freeze({
    generation: options.generation,
    payloads,
    activate(authority: WorkroomJournalPayloadPort): void {
      options.signal.throwIfAborted();
      if (delegate) throw new Error('Workroom Journal payload authority is already active');
      delegate = authority;
    },
  });
}
