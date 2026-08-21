import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';

export interface LegacyRunsOfflineCommandOptions {
  readonly input: string;
  readonly output?: string;
  readonly runId?: string;
  readonly proposal?: 'cancel' | 'replan';
  readonly projectId?: string;
}

export type LegacyRunsOfflineCommandOutput =
  | import('@zhin.js/agent').LegacyRunOfflineReport
  | import('@zhin.js/agent').LegacyRunMigrationProposal;

/** Offline-only file command: imports contracts, never constructs a Host or Agent runtime. */
export async function executeLegacyRunsOfflineCommand(
  options: LegacyRunsOfflineCommandOptions,
): Promise<LegacyRunsOfflineCommandOutput> {
  const inputPath = resolve(options.input);
  const outputPath = options.output ? resolve(options.output) : undefined;
  if (outputPath === inputPath) {
    throw new Error('Legacy Run offline export must not overwrite its source');
  }
  if (options.proposal && !options.runId) {
    throw new Error('Legacy Run migration --proposal requires --run');
  }
  if (options.runId && !options.proposal) {
    throw new Error('Legacy Run migration --run requires --proposal cancel|replan');
  }
  if (options.proposal === 'replan' && !options.projectId) {
    throw new Error('Legacy Run replan proposal requires a target Project via --project');
  }
  if (options.proposal !== undefined
    && options.proposal !== 'cancel'
    && options.proposal !== 'replan') {
    throw new Error('Legacy Run migration proposal must be cancel or replan');
  }
  let source: unknown;
  try {
    source = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Legacy Run offline input is not readable valid JSON: ${inputPath}`, {
      cause: error,
    });
  }
  const agent = await import('@zhin.js/agent');
  const report = agent.buildLegacyRunOfflineReport(source);
  const value = options.proposal
    ? agent.createLegacyRunMigrationProposal(report, {
        legacyRunId: options.runId!,
        action: options.proposal,
        ...(options.projectId ? { targetProjectId: options.projectId } : {}),
      })
    : report;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    // Create-only: an audit export must not silently replace prior evidence.
    await writeFile(outputPath, serialized, { encoding: 'utf8', flag: 'wx' });
  } else {
    console.log(serialized.trimEnd());
  }
  return value;
}

export function registerLegacyRunsOfflineCommand(agentCommand: Command): void {
  agentCommand
    .command('legacy-runs <input>')
    .description('Offline read-only audit/export of removed orchestration Run data')
    .option('-o, --output <file>', 'Create a JSON audit/proposal file instead of stdout')
    .option('--run <legacyRunId>', 'Select one migration_required legacy Run')
    .option('--proposal <action>', 'Emit proposal-only cancel|replan data; never write a Journal')
    .option('--project <projectId>', 'Required target Project for a replan proposal')
    .action(async (
      input: string,
      options: Readonly<{
        output?: string;
        run?: string;
        proposal?: string;
        project?: string;
      }>,
    ) => {
      await executeLegacyRunsOfflineCommand({
        input,
        ...(options.output ? { output: options.output } : {}),
        ...(options.run ? { runId: options.run } : {}),
        ...(options.proposal ? { proposal: options.proposal as 'cancel' | 'replan' } : {}),
        ...(options.project ? { projectId: options.project } : {}),
      });
    });
}
