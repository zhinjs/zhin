import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, syncPrivateDirectory } from '@zhin.js/plugin-runtime';

export interface WriteMigrationRecordOptions {
  readonly directory: string;
  readonly filename: string;
  readonly document: unknown;
}
/** Private atomic journal replacement shared by migration units; it does not perform business mutations. */
export async function writePrivateMigrationRecord(
  options: WriteMigrationRecordOptions
): Promise<void> {
  await privateDirectory(options.directory, true);
  const temporary = join(options.directory, `${randomUUID()}.tmp`),
    handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(options.document));
    await handle.sync();
    await handle.close();
    await rename(temporary, join(options.directory, options.filename));
    await syncPrivateDirectory(options.directory);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
