/**
 * Runs the project's Zhin instance in this process (`zhin runtime start` as the supervised
 * instance child, or `--standalone`). Kept apart from the `runtime` command tree so the instance
 * child can load just this (#1250).
 */
import { resolve } from 'node:path';
import { parseStartOptions } from '@zhin.js/runtime';
import { importProjectInstance } from '../utils/project-instance.js';

export async function runProjectInstance(args: readonly string[]): Promise<void> {
  const root = resolve(process.cwd());
  const parsed = parseStartOptions([...args]);
  // The instance composition root lives in the project's `zhin.js` (ADR 0054 §0). Under the
  // gateway it serves HTTP over the control channel; `--standalone` (dev / test only) runs it
  // here with its own Node HTTP server.
  const { runStartCommand } = await importProjectInstance(root);
  await runStartCommand({
    root,
    args: [...args],
    standaloneHttp: parsed.standalone,
    writeOutput: (value) => process.stdout.write(value),
    writeError: (value) => process.stderr.write(value),
  });
}
