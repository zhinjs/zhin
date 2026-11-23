/**
 * The scaffold wizard (catalogs, project config loading, database dialect definitions) loads on
 * first use. Gateway modules the supervised instance imports (`@zhin.js/gateway/iam`,
 * `@zhin.js/gateway/plugin-management`) must not load it at startup (#1250
 * `instance-still-loads-cli-bits`): import it through this loader, never statically.
 */
type ScaffoldWizard = typeof import('@zhin.js/scaffold-wizard');

let pending: Promise<ScaffoldWizard> | undefined;

export function loadScaffoldWizard(): Promise<ScaffoldWizard> {
  pending ??= import('@zhin.js/scaffold-wizard').catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
