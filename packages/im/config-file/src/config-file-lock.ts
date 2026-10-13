import { open, lstat, readFile, unlink, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const WAIT_MS = 20;
const TIMEOUT_MS = 5_000;

/** Cooperative cross-process exclusion; crashed writers require explicit recovery. */
export async function withConfigFileLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const lock = join(dirname(file), `.${basename(file)}.zhin-lock`);
  const handle = await acquire(lock);
  let identity: Awaited<ReturnType<FileHandle['stat']>> | undefined;
  const marker = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  let initialized = false;
  let result: T | undefined;
  let failed = false;
  let failure: unknown;
  try {
    identity = await handle.stat();
    await handle.writeFile(marker, 'utf8');
    initialized = true;
    result = await operation();
  } catch (error) { failed = true; failure = error; }
  const cleanupErrors: unknown[] = [];
  try {
    // Keep our descriptor open while checking identity so a deleted inode
    // cannot be recycled into a different writer's lock before release.
    if (identity) {
      const current = await lstat(lock);
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
        || initialized && await readFile(lock, 'utf8') !== marker) throw new Error(`Configuration lock ownership changed: ${lock}`);
      await unlink(lock);
    }
  } catch (error) { cleanupErrors.push(error); }
  try { await handle.close(); } catch (error) { cleanupErrors.push(error); }
  if (failed && cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'Configuration mutation and lock cleanup failed', { cause: failure });
  if (failed) throw failure;
  if (cleanupErrors.length === 1) throw cleanupErrors[0];
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Configuration lock cleanup failed');
  return result as T;
}

async function acquire(lock: string): Promise<FileHandle> {
  const deadline = performance.now() + TIMEOUT_MS;
  for (;;) {
    try { return await open(lock, 'wx', 0o600); }
    catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      // Never steal a lock: it may belong to a live slow writer, or a crashed
      // process that has left a rename/rollback requiring human inspection.
      let source: string;
      try { source = await readFile(lock, 'utf8'); }
      catch (readError) { if (hasCode(readError, 'ENOENT')) continue; throw readError; }
      let pid: unknown;
      try { pid = (JSON.parse(source) as { pid?: unknown }).pid; }
      catch { /* The creator may not have finished writing its marker yet. */ }
      if (typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (probe) {
          if (hasCode(probe, 'ESRCH')) {
            // The probed writer may have released its lock before exiting;
            // never diagnose a replacement writer's marker as abandoned.
            let current: string;
            try { current = await readFile(lock, 'utf8'); }
            catch (readError) { if (hasCode(readError, 'ENOENT')) continue; throw readError; }
            if (current !== source) continue;
            throw new Error(`Previous configuration writer ${pid} exited. Inspect ${lock} and the config file, then remove the abandoned lock before retrying.`, { cause: probe });
          }
          if (!hasCode(probe, 'EPERM')) throw probe;
        }
      }
      if (performance.now() >= deadline) throw new Error(`Configuration file is locked: ${lock}. Refresh and retry after the current writer finishes; do not remove a live writer's lock.`, { cause: error });
      await new Promise<void>(resolve => setTimeout(resolve, WAIT_MS));
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
