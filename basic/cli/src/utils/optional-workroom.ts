/**
 * Optional `@zhin.js/workroom` loading helpers. Only a genuinely missing
 * package counts as "not installed"; every other failure keeps failing closed.
 */

const WORKROOM_PACKAGE = '@zhin.js/workroom';
const WORKROOM_ROOT_SPECIFIER = /['"]@zhin\.js\/workroom['"]/u;

/**
 * True only for ERR_MODULE_NOT_FOUND naming the `@zhin.js/workroom` package
 * root (quoted). Paths inside node_modules, subpaths, and other packages
 * (e.g. a transitive dependency of workroom) are not "not installed".
 */
export function isWorkroomPackageMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'ERR_MODULE_NOT_FOUND'
    && typeof message === 'string'
    && WORKROOM_ROOT_SPECIFIER.test(message);
}

export type WorkroomPackage = typeof import('@zhin.js/workroom');

export const WORKROOM_INSTALL_HINT = `需要安装 ${WORKROOM_PACKAGE}（Workroom）。运行: pnpm add ${WORKROOM_PACKAGE}`;

export async function loadWorkroomPackage(
  importer: () => Promise<WorkroomPackage> = () => import('@zhin.js/workroom'),
): Promise<WorkroomPackage> {
  try {
    return await importer();
  } catch (error) {
    if (isWorkroomPackageMissing(error)) {
      throw new Error(WORKROOM_INSTALL_HINT, { cause: error });
    }
    throw error;
  }
}

export type WorkroomRemotePackage = typeof import('@zhin.js/workroom/remote');

/**
 * Loads the frozen A2A remote extension (`@zhin.js/workroom/remote`). Used by
 * protocol-host-installer's A2A transport wiring only when
 * `a2a.workroomCallbacks.enabled`; the default assembly imports the subpath
 * statically.
 */
export async function loadWorkroomRemotePackage(
  importer: () => Promise<WorkroomRemotePackage> = () => import('@zhin.js/workroom/remote'),
): Promise<WorkroomRemotePackage> {
  try {
    return await importer();
  } catch (error) {
    if (isWorkroomPackageMissing(error)) {
      throw new Error(WORKROOM_INSTALL_HINT, { cause: error });
    }
    throw error;
  }
}
