import { randomUUID } from 'node:crypto';
import { chmod, open, rename, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

/**
 * Replaces `file` with `source` without ever exposing a partial file: writes a sibling
 * temporary file, fsyncs it, renames it over the target and (best effort) fsyncs the
 * directory. On any failure the temporary file is removed and the target is untouched.
 * `mode` (permission bits) is applied to the new file; omitted, the process default applies.
 */
export async function atomicWriteFile(file: string, source: string, options: Readonly<{ mode?: number }> = {}): Promise<void> {
  const target = resolve(file);
  const temporary = resolve(dirname(target), `${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const mode = options.mode === undefined ? undefined : options.mode & 0o7777;
  try {
    const handle = await open(temporary, 'wx', mode ?? 0o666);
    try {
      await handle.writeFile(source, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    // open()'s mode is filtered by the umask; set the exact bits that must survive.
    if (mode !== undefined && process.platform !== 'win32') await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(target));
}

async function syncDirectory(directory: string): Promise<void> {
  // Directory handles cannot be fsynced on Windows; elsewhere this makes the rename durable.
  if (process.platform === 'win32') return;
  try {
    const handle = await open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch { /* Some filesystems reject directory fsync; the rename itself already happened. */ }
}
