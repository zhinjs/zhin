import fs from 'fs-extra';
import path from 'path';
import { createConfigDocument } from '@zhin.js/config-file';
import { findConfigFile } from './config-file.js';

/** Public upgrade guide for the configVersion 2 (flat plugin instance) migration. */
export const CONFIG_V2_MIGRATION_DOCS_URL = 'https://zhin.js.org/operations/upgrades#configversion-2';
export const CONFIG_V2_MIGRATION_COMMANDS = Object.freeze([
  'zhin stop',
  'zhin migrate instances',
  'zhin migrate instances --apply',
] as const);

export interface LegacyConfigDetection {
  /** True when the project still uses the unversioned (v1) configuration layout. */
  readonly legacy: boolean;
  /** Root configuration file relative to the project, when one exists. */
  readonly configFile?: string;
  /** Human-readable evidence, never containing configuration values. */
  readonly reasons: readonly string[];
}

/**
 * Detects a v1 (pre-configVersion 2) project without validating or executing anything.
 * Only key presence is inspected, so the result never carries configuration values.
 */
export async function detectLegacyConfig(root: string): Promise<LegacyConfigDetection> {
  const reasons: string[] = [];
  const configFile = findConfigFile(root) ?? undefined;
  if (configFile) {
    try {
      const { document } = await createConfigDocument(path.join(root, configFile)).read();
      if (document && typeof document === 'object' && !Array.isArray(document)
        && (document as Record<string, unknown>).configVersion === undefined) {
        reasons.push(`${configFile} 缺少 configVersion: 2 / ${configFile} has no configVersion: 2`);
      }
    } catch {
      // Syntax errors are reported by the regular config diagnostics.
    }
  }
  const packageFile = path.join(root, 'package.json');
  try {
    const manifest = await fs.readJson(packageFile) as { zhin?: { plugins?: unknown } };
    if (Array.isArray(manifest.zhin?.plugins) && manifest.zhin.plugins.length) {
      reasons.push('package.json 仍有 zhin.plugins 旧挂载 / package.json still declares zhin.plugins');
    }
  } catch {
    // Missing or malformed package.json is reported elsewhere.
  }
  return Object.freeze({ legacy: reasons.length > 0, configFile, reasons: Object.freeze(reasons) });
}

/** Multi-line, bilingual migration hint shared by start, config check and doctor. */
export function formatLegacyConfigHint(detection: Pick<LegacyConfigDetection, 'reasons'>): string {
  return [
    '检测到 v1 配置：当前版本只接受 configVersion: 2，旧配置不会再被加载。',
    'Detected a v1 configuration: this Zhin release only accepts configVersion: 2.',
    ...detection.reasons.map(reason => `  - ${reason}`),
    '迁移步骤 / How to migrate:',
    `  1. 先停止 Bot / stop the Bot first:      ${CONFIG_V2_MIGRATION_COMMANDS[0]}`,
    `  2. 预览改动 / preview (writes nothing):  ${CONFIG_V2_MIGRATION_COMMANDS[1]}`,
    `  3. 应用迁移 / apply (auto backup):       ${CONFIG_V2_MIGRATION_COMMANDS[2]}`,
    `文档 / Docs: ${CONFIG_V2_MIGRATION_DOCS_URL}`,
  ].join('\n');
}

export class LegacyConfigError extends Error {
  readonly code = 'ZHIN_LEGACY_CONFIG_V1';
  constructor(readonly detection: LegacyConfigDetection) {
    super(formatLegacyConfigHint(detection));
    this.name = 'LegacyConfigError';
  }
}

/** Throws a {@link LegacyConfigError} carrying the migration steps when the project is still v1. */
export async function assertNotLegacyConfig(root: string): Promise<void> {
  const detection = await detectLegacyConfig(root);
  if (detection.legacy) throw new LegacyConfigError(detection);
}
