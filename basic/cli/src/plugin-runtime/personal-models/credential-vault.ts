import { createHash, randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { HostCredentialStorageError, createHostDocumentCipher, hasCode, privateDirectory,
  readPrivateDocument, createPrivateDocument, syncPrivateDirectory } from '../host-credential-storage.js';
import { PersonalModelCredentialError, type PersonalModelCredentialVault } from './types.js';

const REFERENCE = /^personal-model-secret:v1:[a-f0-9]{48}$/u;
function inputText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new PersonalModelCredentialError('invalid_input');
}
function credentialFile(secretRef: string): string {
  return `${createHash('sha256').update(secretRef).digest('hex')}.json`;
}
function aad(ownerId: string, secretRef: string): Buffer {
  return Buffer.from(JSON.stringify(['personal-model-credential', 1, ownerId, secretRef]));
}
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) {
    if (error instanceof PersonalModelCredentialError) throw error;
    if (error instanceof HostCredentialStorageError) throw new PersonalModelCredentialError(error.code);
    throw new PersonalModelCredentialError('storage');
  }
}
/** Host-private vault. Its references, AAD and disk format remain unchanged. */
export function createPersonalModelCredentialVault(options: Readonly<{ directory: string }>): PersonalModelCredentialVault {
  inputText(options.directory);
  const directory = options.directory;
  const cipher = createHostDocumentCipher(directory);
  const vault: PersonalModelCredentialVault = {
    async prepare(input) {
      const secretRef = await vault.put(input);
      let rollback: Promise<void> | undefined;
      return Object.freeze({ secretRef, rollback: () => rollback ??= safe(async () => {
        await privateDirectory(directory, false);
        await unlink(join(directory, credentialFile(secretRef))); await syncPrivateDirectory(directory);
      }) });
    },
    put(input): Promise<string> {
      return safe(async () => {
        const { ownerId, apiKey } = input; inputText(ownerId); inputText(apiKey);
        await privateDirectory(directory, true);
        const secretRef = `personal-model-secret:v1:${randomBytes(24).toString('hex')}`;
        const document = await cipher.seal(apiKey, aad(ownerId, secretRef));
        if (!await createPrivateDocument(directory, credentialFile(secretRef), document)) throw new PersonalModelCredentialError('storage');
        return secretRef;
      });
    },
    resolve(input): Promise<string> {
      return safe(async () => {
        const { ownerId, secretRef } = input; inputText(ownerId);
        if (typeof secretRef !== 'string' || !REFERENCE.test(secretRef)) throw new PersonalModelCredentialError('invalid_input');
        let document: unknown;
        try {
          await privateDirectory(directory, false);
          document = await readPrivateDocument(join(directory, credentialFile(secretRef)));
        } catch (error) {
          if (hasCode(error, 'ENOENT')) throw new PersonalModelCredentialError('not_found');
          throw error;
        }
        return cipher.open(document, aad(ownerId, secretRef));
      });
    },
  };
  return Object.freeze(vault);
}
