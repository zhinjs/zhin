import { isAbsolute, relative, sep } from 'node:path';
import type { ProjectFileWatch, Scope } from '@zhin.js/plugin-runtime';
import { normalizeSourcePath } from './source-path.js';

/**
 * Files a Root installer declared it reads itself (#1250 `hmr-multi-change-full-rebuild`).
 * Keyed by the Root Scope that made the declaration, so the declaration lives exactly as long as
 * that Scope: a retained Root keeps it, a replaced Root brings its own.
 */
const registries = new WeakMap<Scope, ProjectFileWatchRegistry>();

export class ProjectFileWatchRegistry {
  readonly #watches: Array<{ readonly matchers: readonly RegExp[]; readonly watch: ProjectFileWatch }> = [];

  constructor(private readonly projectRoot: string) {}

  add(watch: ProjectFileWatch): void {
    if (!watch || !Array.isArray(watch.patterns) || typeof watch.onChange !== 'function') {
      throw new TypeError('watchProjectFiles requires { patterns: string[], onChange }');
    }
    this.#watches.push(Object.freeze({
      matchers: Object.freeze(watch.patterns.map(compileProjectFilePattern)),
      watch,
    }));
  }

  get size(): number { return this.#watches.length; }

  matches(source: string): boolean {
    const path = projectRelative(this.projectRoot, source);
    return path !== undefined && this.#watches.some(({ matchers }) => matchers.some((matcher) => matcher.test(path)));
  }

  /** Calls every declaration that matches one of the files, with its matching files. */
  async notify(files: readonly string[]): Promise<void> {
    const errors: unknown[] = [];
    for (const { matchers, watch } of this.#watches) {
      const matched = files.filter((file) => {
        const path = projectRelative(this.projectRoot, file);
        return path !== undefined && matchers.some((matcher) => matcher.test(path));
      });
      if (matched.length === 0) continue;
      try {
        await watch.onChange(Object.freeze({ files: Object.freeze([...matched]) }));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Project file watch handlers failed');
  }
}

export function attachProjectFileWatches(scope: Scope, projectRoot: string): ProjectFileWatchRegistry {
  const registry = new ProjectFileWatchRegistry(normalizeSourcePath(projectRoot));
  registries.set(scope, registry);
  return registry;
}

export function projectFileWatchesOf(scope: Scope | undefined): ProjectFileWatchRegistry | undefined {
  return scope ? registries.get(scope) : undefined;
}

/** `AGENTS.md`, `knowledge/**`, `prompts/*.md` → an anchored matcher over `/`-separated relative paths. */
export function compileProjectFilePattern(pattern: string): RegExp {
  if (typeof pattern !== 'string' || pattern.trim() === '') {
    throw new TypeError('Project file pattern must be a non-empty string');
  }
  const normalized = pattern.split('\\').join('/').replace(/^\.\//u, '');
  if (normalized.startsWith('/') || isAbsolute(pattern) || normalized.split('/').includes('..')) {
    throw new TypeError(`Project file pattern must stay inside the project: ${pattern}`);
  }
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized.charAt(index);
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        const slash = normalized[index + 2] === '/';
        source += slash ? '(?:.*/)?' : '.*';
        index += slash ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'u');
}

function projectRelative(projectRoot: string, source: string): string | undefined {
  const path = relative(projectRoot, normalizeSourcePath(source));
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return undefined;
  return path.split(sep).join('/');
}
