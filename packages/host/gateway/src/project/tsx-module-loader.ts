import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TsxModuleLoader } from '@zhin.js/runtime';

interface ScopedTsxRegistration {
  import(specifier: string, parentURL: string): Promise<unknown>;
  unregister(): Promise<void>;
}

/**
 * Creates a lazy, namespaced TSX loader for the CLI composition root.
 * It does not replace Node's native `.ts` handling and is registered only
 * after the active process loader reports that it cannot load a `.tsx` file.
 */
export function createTsxModuleLoader(projectRoot: string): TsxModuleLoader {
  const root = resolve(projectRoot);
  const tsconfigFile = join(root, 'tsconfig.json');
  let registration: Promise<ScopedTsxRegistration> | undefined;
  const acquire = (): Promise<ScopedTsxRegistration> => {
    registration ??= import('tsx/esm/api').then(({ register }) => register({
      namespace: `zhin-runtime:${pathToFileURL(root).href}`,
      tsconfig: existsSync(tsconfigFile) ? tsconfigFile : false,
    }));
    return registration;
  };

  return Object.freeze({
    async load<T>(source: string, parentURL: string): Promise<T> {
      return (await acquire()).import(source, parentURL) as Promise<T>;
    },
    async close(): Promise<void> {
      if (registration) await (await registration).unregister();
    },
  });
}
