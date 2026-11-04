import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import type { RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import {
  ConfigComposer, ConfigValidationError, NativeDevelopmentModuleRuntime,
  NodePackageResolver, ProjectGraphService,
} from '@zhin.js/runtime';
import { findConfigFile } from './config-file.js';
import { createTsxModuleLoader } from '../plugin-runtime/start/tsx-module-loader.js';
import { loadAiConfigUtils } from './ai-config-loader.js';
import { hostModelOwnerId } from '../plugin-runtime/inference/host-identity.js';
import { ConsoleConfigurationStore } from '../plugin-runtime/console/configuration.js';

export function requireConfigFile(root: string): string {
  const name = findConfigFile(root);
  if (!name) throw new Error('未找到配置文件');
  return join(root, name);
}

export const ENVIRONMENT_NAME = /^[a-z0-9][a-z0-9-]*$/u;

export function assertEnvironmentName(environment: string): string {
  if (!ENVIRONMENT_NAME.test(environment)) throw new TypeError('无效的环境名称');
  return environment;
}

/**
 * Complete declaration/schema composition, without starting a Runtime or calling Plugin setup.
 * Trusted declaration imports execute module top-level code, exactly as composition does.
 */
export async function validateOfflineConfiguration(
  root: string, document: RuntimeConfigDocument, environment: string,
  pluginOrder?: readonly string[],
) {
  assertEnvironmentName(environment);
  // Reject retired model authority before environment expansion or declaration loading.
  // Runtime model resources are reviewed/applied through the inference repository.
  const validateAi = (ai: unknown): void => {
    // Disabled AI is not an installed domain in an IM-only project. Structured
    // AI writes still have their own mandatory validation in ConsoleConfigurationStore.
    if (ai === undefined || (ai && typeof ai === 'object' && !Array.isArray(ai) && 'enabled' in ai && ai.enabled === false)) return;
    const validate = loadAiConfigUtils(root)?.validateModelRuntimeConfig;
    if (!validate) throw new ConfigValidationError(['AI configuration validation requires the installed Agent package']);
    const errors = validate(ai, hostModelOwnerId(root));
    if (errors.length) throw new ConfigValidationError(errors);
  };
  validateAi(document.ai);
  const modules = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false, tsxLoader: createTsxModuleLoader(root) });
  try {
    const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, document, pluginOrder);
    const composed = await new ConfigComposer([], modules).compose(graph, document);
    validateAi(composed.document.ai);
    return composed;
  } finally {
    await modules.close();
  }
}

/**
 * The `--offline` configuration authority: the same {@link ConsoleConfigurationStore}
 * (`patchProject` CAS, declaration rejection, per-section schema checks, masked reads)
 * as a running Host, but without `applyConfiguration`. It never constructs a Runtime
 * or runs Plugin setup; declaration validation may import modules (top-level code runs).
 */
export function createOfflineConfigurationStore(root: string, environment: string): ConsoleConfigurationStore {
  assertEnvironmentName(environment);
  const document = createConfigDocument(requireConfigFile(root));
  return new ConsoleConfigurationStore({
    projectRoot: root,
    document,
    environmentName: environment,
    validateConfiguration: async candidate => { await validateOfflineConfiguration(root, candidate, environment); },
  });
}
