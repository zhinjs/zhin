export interface PreparedPersonalModelCredential {
  readonly secretRef: string;
  /** Only for a definitively rejected metadata write; unknown commit outcomes retain the credential. */
  rollback(): Promise<void>;
}
export interface PersonalModelCredentialVault {
  prepare(input: Readonly<{ ownerId: string; apiKey: string }>): Promise<PreparedPersonalModelCredential>;
  put(input: Readonly<{ ownerId: string; apiKey: string }>): Promise<string>;
  resolve(input: Readonly<{ ownerId: string; secretRef: string }>): Promise<string>;
}

export type PersonalModelCredentialErrorCode = 'invalid_input' | 'not_found' | 'integrity' | 'storage';

/** Deliberately excludes raw filesystem/crypto errors, paths, submitted keys and causes. */
export class PersonalModelCredentialError extends Error {
  constructor(readonly code: PersonalModelCredentialErrorCode) {
    super({
      invalid_input: 'Invalid personal model credential input',
      not_found: 'Personal model credential was not found',
      integrity: 'Personal model credential integrity could not be verified',
      storage: 'Personal model credential storage is unavailable',
    }[code]);
    this.name = 'PersonalModelCredentialError';
  }
}
