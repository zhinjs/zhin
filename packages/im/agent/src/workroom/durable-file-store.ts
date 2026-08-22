import { randomUUID } from 'node:crypto';
import {
  link as nodeLink,
  mkdir as nodeMkdir,
  open as nodeOpen,
  unlink as nodeUnlink,
} from 'node:fs/promises';
import { dirname } from 'node:path';

export interface DurableFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** The intentionally narrow filesystem seam used by immutable Workroom facts. */
export interface DurableFileSystem {
  mkdir(path: string): Promise<void>;
  open(path: string, flags: 'wx' | 'r'): Promise<DurableFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export const nodeDurableFileSystem: DurableFileSystem = Object.freeze({
  mkdir: async (path: string): Promise<void> => { await nodeMkdir(path); },
  open: async (path: string, flags: 'wx' | 'r'): Promise<DurableFileHandle> =>
    await nodeOpen(path, flags),
  link: async (existingPath: string, newPath: string): Promise<void> =>
    await nodeLink(existingPath, newPath),
  unlink: async (path: string): Promise<void> => { await nodeUnlink(path); },
});

export interface CreateOnlyPublishOptions<Created, Replayed> {
  readonly target: string;
  readonly content: string;
  readonly createdValue: Created;
  readonly onConflict: () => Promise<Replayed>;
}

export type CreateOnlyPublishResult<Created, Replayed> =
  | Readonly<{ status: 'created'; value: Created }>
  | Readonly<{ status: 'replayed'; value: Replayed }>;

/**
 * Crash-durable filesystem operations shared by Workroom file repositories.
 *
 * `directory` is a leaf owned by one repository. Its parent is never created
 * recursively: callers must provision and durably publish that parent first.
 */
export class DurableFileStore {
  constructor(
    readonly directory: string,
    readonly fileSystem: DurableFileSystem = nodeDurableFileSystem,
  ) {}

  async ensureDurableLeaf(repositoryLabel: string): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.directory);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) {
        if (hasCode(error, 'ENOENT')) {
          throw new Error(
            `${repositoryLabel} requires a pre-existing durable parent directory: `
            + dirname(this.directory),
            { cause: error },
          );
        }
        throw error;
      }
    }
    await this.syncPath(dirname(this.directory));
  }

  async syncPath(path: string): Promise<void> {
    const handle = await this.fileSystem.open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async syncLeaf(): Promise<void> {
    await this.syncPath(this.directory);
  }

  async syncLeafAndParent(): Promise<void> {
    await this.syncLeaf();
    await this.syncPath(dirname(this.directory));
  }

  /**
   * Publishes immutable content through a hard link. A target collision is a
   * domain-level replay/CAS decision delegated to `onConflict`; successful
   * replay is confirmed only after re-syncing the leaf directory. This closes
   * the lost-response window where link(2) succeeded but directory fsync did
   * not.
   */
  async publishCreateOnly<Created, Replayed>(
    options: CreateOnlyPublishOptions<Created, Replayed>,
  ): Promise<CreateOnlyPublishResult<Created, Replayed>> {
    const temporary = `${options.target}.${randomUUID()}.tmp`;
    let temporaryExists = false;
    try {
      const handle = await this.fileSystem.open(temporary, 'wx');
      temporaryExists = true;
      try {
        await handle.writeFile(options.content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      try {
        await this.fileSystem.link(temporary, options.target);
      } catch (error) {
        if (!hasCode(error, 'EEXIST')) throw error;
        await this.#removeTemporary(temporary);
        temporaryExists = false;
        const replayed = await options.onConflict();
        await this.syncLeaf();
        return Object.freeze({ status: 'replayed', value: replayed });
      }

      await this.#removeTemporary(temporary);
      temporaryExists = false;
      await this.syncLeaf();
      return Object.freeze({ status: 'created', value: options.createdValue });
    } finally {
      if (temporaryExists) await this.#removeTemporary(temporary);
    }
  }

  async removeIfExists(path: string, syncDirectoryAfter = false): Promise<void> {
    let removed = false;
    try {
      await this.fileSystem.unlink(path);
      removed = true;
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
    }
    if (removed && syncDirectoryAfter) await this.syncLeaf();
  }

  async #removeTemporary(path: string): Promise<void> {
    await this.removeIfExists(path);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
