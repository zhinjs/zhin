export class PersistenceUnavailableError extends Error {
  override readonly name = 'PersistenceUnavailableError';

  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Persistence operation failed: ${operation}`, { cause });
  }
}

export function persistenceFailure(operation: string, cause: unknown): PersistenceUnavailableError {
  return cause instanceof PersistenceUnavailableError
    ? cause
    : new PersistenceUnavailableError(operation, cause);
}
