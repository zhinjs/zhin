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

/**
 * #1250 command-namespace-param-commands-swallowed: a plugin whose `commandNamespace` ends with
 * the first word of one of its own commands (namespace `60s` + command `60s` → `60s 60s`). Users
 * typing the bare word get the namespace's command list, not that command; warn once so the owner
 * can pick another namespace.
 */
export function describeNamespaceCollisions(snapshot: RuntimeSnapshot): readonly LogFields[] {
  const index = snapshot.projections.get(commandFeatureId);
  if (!isCommandIndex(index)) return [];
  const found: LogFields[] = [];
  const seen = new Set<string>();
  for (const command of index.list()) {
    const namespace = (snapshot.config.get(command.owner) as { commandNamespace?: unknown } | undefined)?.commandNamespace;
    if (typeof namespace !== 'string' || !namespace.trim()) continue;
    const words = namespace.trim().split(/\s+/u);
    const last = words.at(-1)!;
    const local = command.name.split(/\s+/u).slice(words.length);
    if (local[0] !== last) continue;
    const plugin = snapshot.tree.get(command.owner)?.instanceKey ?? String(command.owner);
    const key = `${plugin}\0${command.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      op: 'command_namespace_collision',
      generation: snapshot.generation,
      plugin,
      namespace: words.join(' '),
      command: command.name,
      hint: `"${words.join(' ')}" is both ${plugin}'s commandNamespace and one of its commands: users must type "${command.name}"; `
        + `"${words.join(' ')}" alone lists the namespace's commands. Choose another commandNamespace to avoid the repetition.`,
    });
  }
  return found;
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
    for (const collision of describeNamespaceCollisions(snapshot)) {
      const key = `namespace\0${String(collision.plugin)}\0${String(collision.command)}`;
      current.add(key);
      if (!this.#logged.has(key)) this.warn(collision);
    }
    // A resolved conflict that comes back later is logged again.
    this.#logged = current;
  }
}
