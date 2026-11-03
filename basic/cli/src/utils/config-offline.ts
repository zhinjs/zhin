import { join } from 'node:path';
import { createConfigDocument, ConfigDocumentConflictError } from '@zhin.js/config-file';
import { rootPluginId, type ConfigPatch, type RuntimeConfigDocument, type PreparedConfigDocument } from '@zhin.js/plugin-runtime';
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

export function requireConfigFile(root: string): string {
  const name = findConfigFile(root);
  if (!name) throw new Error('未找到配置文件');
  return join(root, name);
}

/**
 * Complete declaration/schema composition, without starting a Runtime or calling Plugin setup.
 * Trusted declaration imports execute module top-level code, exactly as composition does.
 */
export async function validateOfflineConfiguration(
  root: string, document: RuntimeConfigDocument, environment: string,
  pluginOrder?: readonly string[],
) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(environment)) throw new TypeError('无效的环境名称');
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

/** Offline writes retain the original source revision across declaration loading and final CAS. */
export async function patchOfflineConfiguration(root: string, patches: readonly ConfigPatch[], environment: string) {
  const file = requireConfigFile(root);
  const document = createConfigDocument(file);
  const current = await document.read();
  const prepared = await document.prepare(current, patches);
  try {
    await validateOfflineConfiguration(root, prepared.document, environment, prepared.pluginOrder);
  } catch (error) {
    // A prepared ConfigFileDocument is inert: rollback only aborts its state,
    // without compensating any external file changes made during imports.
    await prepared.rollback();
    throw error;
  }
  return commitOfflineConfiguration(prepared, current.revision);
}

/** The only uncertain phase is commit: validation/prepare/CAS errors retain their existing meaning. */
export async function commitOfflineConfiguration(prepared: PreparedConfigDocument, expectedRevision: string) {
  let saved;
  try { saved = await prepared.commit(); }
  catch (error) {
    if (error instanceof ConfigDocumentConflictError) throw error;
    // A write may have reached disk before acknowledgement failed. Preserve the
    // current file and original revision evidence; never compensate or retry.
    return Object.freeze({ status: 'unconfirmed' as const, expectedRevision,
      application: 'not-requested' as const, message: '离线保存结果未确认；请核对文件及版本，不要直接重试。未请求运行中 Host 生效。' });
  }
  return Object.freeze({ status: 'saved' as const, revision: saved.revision, application: 'not-requested' as const,
    message: '配置已离线保存，未请求运行中 Host 生效' });
}
