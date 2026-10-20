import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Keep file events and scanned sources in the same physical path namespace.
 * Resolve the nearest existing parent for unlink events and newly added files.
 */
export function normalizeSourcePath(source: string): string {
  const absolute = resolve(source);
  let parent = absolute;
  const suffix: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(parent), ...suffix);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const next = dirname(parent);
      if (next === parent) return absolute;
      suffix.unshift(basename(parent));
      parent = next;
    }
  }
}
