/**
 * #1250 duplicate-command-route-crashes-instance: a command route two plugins claim no longer
 * fails the instance; the Command index keeps the earlier registration and reports the conflict.
 * This logs each conflict once (on the generation that first shows it) as a warning; the same
 * conflicts are listed in the Console 「需要你处理」 (`command.conflict`) and in `zhin doctor`.
 */
import { commandFeatureId, isCommandIndex, type CommandRouteClaimant, type CommandRouteConflict } from '@zhin.js/command';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';

type LogFields = Record<string, string | number | boolean | undefined>;

function side(claimant: CommandRouteClaimant): string {
  const route = claimant.kind === 'command' ? claimant.command : `${claimant.command} ${claimant.kind}=${claimant.entry ?? ''}`;
  return `${claimant.plugin}:${route}`;
}

/** Structured `command_route_conflict` warning for one conflict. */
export function describeCommandConflictLog(conflict: CommandRouteConflict, generation: number): LogFields {
  const { skipped, kept } = conflict;
  return {
    op: 'command_route_conflict',
    generation,
    route: conflict.route,
    skipped: side(skipped),
    kept: side(kept),
    result: skipped.kind === 'command' ? 'command_not_registered' : `${skipped.kind}_skipped`,
    // A later plugin's command took an earlier plugin's alias / shortcut: users get another command.
    taken_by_later: conflict.takenByLater === true ? true : undefined,
    hint: `rename one of them (or set commandNamespace on ${skipped.plugin}), or disable one: ${skipped.plugin}.disabledCommands: [${skipped.localPath}] / ${kept.plugin}.disabledCommands: [${kept.localPath}]`,
  };
}

function conflictKey(conflict: CommandRouteConflict): string {
  return [conflict.route, side(conflict.skipped), side(conflict.kept)].join('\0');
}

/** Logs the conflicts of each committed generation that were not logged for an earlier one. */
export class CommandConflictLog {
  #logged = new Set<string>();

  constructor(private readonly warn: (fields: LogFields) => void) {}

  report(snapshot: RuntimeSnapshot): void {
    const index = snapshot.projections.get(commandFeatureId);
    const conflicts = isCommandIndex(index) ? index.conflicts() : [];
    const current = new Set<string>();
    for (const conflict of conflicts) {
      const key = conflictKey(conflict);
      current.add(key);
      if (!this.#logged.has(key)) this.warn(describeCommandConflictLog(conflict, snapshot.generation));
    }
    // A resolved conflict that comes back later is logged again.
    this.#logged = current;
  }
}
