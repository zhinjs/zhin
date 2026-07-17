import { readFile, readdir } from 'node:fs/promises';
import type {
  DirectoryEntry,
  DiscoveryHost,
} from '@zhin.js/next-feature-kit';
import type { ModuleRuntime } from './module-runtime.js';

export class NodeDiscoveryHost implements DiscoveryHost {
  constructor(private readonly modules: ModuleRuntime) {}

  async list(directory: string): Promise<readonly DirectoryEntry[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const result: DirectoryEntry[] = [];
      for (const entry of entries) {
        if (entry.isFile()) result.push({ name: entry.name, kind: 'file' });
        if (entry.isDirectory()) result.push({ name: entry.name, kind: 'directory' });
      }
      return result;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  loadModule<T = unknown>(source: string): Promise<T> {
    return this.modules.load<T>(source);
  }

  readText(source: string): Promise<string> {
    return readFile(source, 'utf8');
  }
}
