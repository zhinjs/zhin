import * as path from 'node:path';
import { ConfigLoader } from '@zhin.js/core';
import { getZhinProjectRoot, setZhinProjectRoot } from '../setup/project-root.js';

export function chdirToProjectRoot(root: string): void {
  const resolved = path.resolve(root);
  const g = globalThis as { Deno?: { chdir: (p: string) => void }; process?: { chdir: (p: string) => void } };
  if (g.Deno?.chdir) {
    g.Deno.chdir(resolved);
  } else if (g.process?.chdir) {
    g.process.chdir(resolved);
  }
  setZhinProjectRoot(resolved);
}

export function resolveConfigPath(): string {
  const root = getZhinProjectRoot();
  const configFile = ConfigLoader.discover('zhin.config', root) || 'zhin.config.yml';
  return path.join(root, configFile);
}
