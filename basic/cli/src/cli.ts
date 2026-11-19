#!/usr/bin/env node
/**
 * `zhin` executable entry.
 *
 * The gateway supervises the Zhin instance by spawning this executable again as
 * `zhin runtime start …` with the instance-child environment (ADR 0054 §3). That process only
 * launches the project's `zhin.js/instance`; it must not load the CLI's command tree (scaffold
 * wizard, plugin tooling, preview, …) and keep it resident for the instance's lifetime (#1250).
 */
import { INSTANCE_CHILD_ENV } from '@zhin.js/host-http/bridge';

const args = process.argv.slice(2);

/**
 * Options the instance launcher does not parse itself: help and the program-wide logging flags
 * are handled by the full command tree, so such invocations take the `program.js` path.
 */
const PROGRAM_OPTIONS = new Set(['--help', '-h', '--verbose', '--debug']);

if (
  process.env[INSTANCE_CHILD_ENV]
  && args[0] === 'runtime'
  && args[1] === 'start'
  && !args.slice(2).some((arg) => PROGRAM_OPTIONS.has(arg))
) {
  const { runProjectInstance } = await import('./commands/runtime-instance.js');
  try {
    await runProjectInstance(args.slice(2));
  } catch (error) {
    console.error(`zhin: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else {
  await import('./program.js');
}
