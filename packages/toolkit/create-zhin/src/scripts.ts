/**
 * The `package.json#scripts` every new project gets (before the optional PM2 extras). `zhin
 * migrate` gives an upgraded project the same set (`basic/cli/src/plugin-runtime/migrate/
 * start-scripts.ts`); a test compares the two so they cannot drift apart (#1250).
 */
export const CREATE_BOT_SCRIPTS: Readonly<Record<string, string>> = Object.freeze({
  dev: 'zhin start --foreground --watch source config',
  // Foreground: the production templates (Dockerfile, systemd unit) run `pnpm start`.
  start: 'zhin start --foreground --mode production --no-watch',
  stop: 'zhin stop',
  preview: 'zhin preview',
  build: 'tsc --noEmit',
});
