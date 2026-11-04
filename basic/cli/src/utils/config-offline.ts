import { join } from 'node:path';
import { createConfigDocument } from '@zhin.js/config-file';
import { rootPluginId, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import {
  ConfigComposer, ConfigValidationError, createEnvStore, NativeDevelopmentModuleRuntime,
  NodePackageResolver, ProjectGraphService,
} from '@zhin.js/runtime';
import { findConfigFile } from './config-file.js';
import { loadRuntimeEnvironmentLayers } from '../plugin-runtime/start/environment.js';
import { createTsxModuleLoader } from '../plugin-runtime/start/tsx-module-loader.js';
import { loadAiConfigUtils } from './ai-config-loader.js';
import { hostModelOwnerId } from '../plugin-runtime/personal-models/host-identity.js';
import { isAiEnabledInConfig } from '@zhin.js/scaffold-wizard';
import { modelConfigurationPaths, modelConfigurationEnvironmentReferences } from './model-configuration-environment.js';
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
  const modules = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: false, tsxLoader: createTsxModuleLoader(root) });
  try {
    const graph = await new ProjectGraphService(await NodePackageResolver.create(root)).inspect(root, document, pluginOrder);
    const composed = await new ConfigComposer([], modules).compose(graph, document);
    const layers = await loadRuntimeEnvironmentLayers(root, environment);
    const env = createEnvStore(rootPluginId(), { name: environment, mode: environment === 'production' ? 'production' : 'development', platform: process.platform }, layers);
    const ai = env.expandMissingAsEmpty(composed.document.ai) as Record<string, unknown> | undefined;
    if (ai && ai.enabled !== false && (isAiEnabledInConfig({ ai }) || ai.modelCatalog !== undefined || ai.modelPolicy !== undefined)) {
      const { missing } = modelConfigurationEnvironmentReferences(modelConfigurationPaths(ai.agents), composed.document, ai,
        name => { const value = env.get(name); return typeof value === 'string' && value.length > 0; });
      if (missing.size) throw new ConfigValidationError([`AI model environment references are unavailable: ${[...missing].sort().join(', ')}`]);
      const utils = loadAiConfigUtils(root);
      if (!utils?.validateModelRuntimeConfig) throw new Error('无法完整校验 AI 配置：请安装当前项目对应的 @zhin.js/agent');
      const errors = utils.validateModelRuntimeConfig(ai, hostModelOwnerId(root));
      if (errors.length) throw new ConfigValidationError(errors);
    }
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
