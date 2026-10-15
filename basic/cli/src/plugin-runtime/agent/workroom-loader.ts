import { isWorkroomPackageMissing } from '../../utils/optional-workroom.js';

export { isWorkroomPackageMissing };

export type WorkroomHostModule = typeof import('../workroom/module.js');

/**
 * Loads the Workroom Host module. Resolves `undefined` only when the
 * `@zhin.js/workroom` package itself is not installed; any other load failure
 * is rethrown so a broken installation never silently degrades.
 */
export async function loadWorkroomHostModule(
  importer: () => Promise<WorkroomHostModule> = () => import('../workroom/module.js'),
): Promise<WorkroomHostModule | undefined> {
  try {
    return await importer();
  } catch (error) {
    if (isWorkroomPackageMissing(error)) return undefined;
    throw error;
  }
}
