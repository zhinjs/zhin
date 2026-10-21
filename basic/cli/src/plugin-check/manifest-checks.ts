/**
 * `zhin` manifest and dependency checks for `zhin plugin check`:
 * - the manifest goes through the Runtime's own parser (`parsePackageJson`), so protocol / type /
 *   entry / runtime / features / plugins are validated exactly as at load time;
 * - `zhin.engine` must be a valid range that the current Runtime engine satisfies, and feature `api`
 *   ranges must be valid;
 * - every package referenced by `features` / `plugins` must be declared as a dependency (the
 *   Runtime refuses undeclared references);
 * - peerDependencies follow the plugin delivery policy (docs/authoring/plugin-delivery.md): the
 *   Zhin stack is shared through peers with real semver ranges, and the installed dev copy satisfies them.
 */
import {
  assertPackageEngine,
  ManifestValidationError,
  parsePackageJson,
  runtimeEngineVersion,
  type PackageJson,
} from '@zhin.js/runtime';
import { findInstalledVersion } from '../commands/new-plugin-manifest.js';
import { semver } from './semver.js';
import type { PluginCheckProblems } from './source-checks.js';

const PROTOCOL_PREFIXES_THAT_DO_NOT_PUBLISH = ['file:', 'link:', 'portal:'];
const LOOSE_RANGES = new Set(['latest', '*', '', 'x']);

function isZhinStackPackage(name: string): boolean {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

/** Validates the manifest with the Runtime parser; returns the parsed manifest when it is valid. */
export function checkZhinManifest(
  pluginDirectory: string,
  manifest: Record<string, unknown>,
  problems: PluginCheckProblems,
): PackageJson | undefined {
  let parsed: PackageJson;
  try {
    parsed = parsePackageJson(manifest, 'package.json');
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      for (const issue of error.issues) problems.errors.push(`zhin 清单无效：${issue}`);
      return undefined;
    }
    throw error;
  }
  const zhinManifest = parsed.zhin;
  if (zhinManifest.engine === undefined) {
    problems.warnings.push(`未声明 zhin.engine：建议声明兼容的 Runtime 引擎范围（如 "^${runtimeEngineVersion.split('.')[0]}.0.0"）`);
  } else {
    try {
      assertPackageEngine({ name: parsed.name, root: pluginDirectory, packageJson: parsed, source: 'local' });
    } catch (error) {
      problems.errors.push(`zhin.engine：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (zhinManifest.type === 'plugin') {
    for (const feature of zhinManifest.features) {
      if (feature.api !== undefined && semver.validRange(feature.api) === null) {
        problems.errors.push(`zhin.features 中 ${feature.package} 的 api 不是有效的 semver 范围：${feature.api}`);
      }
    }
    checkReferencesAreDeclared(parsed, problems);
  }
  return parsed;
}

function checkReferencesAreDeclared(parsed: PackageJson, problems: PluginCheckProblems): void {
  if (parsed.zhin.type !== 'plugin') return;
  const declared = new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.optionalDependencies ?? {}),
    ...Object.keys(parsed.peerDependencies ?? {}),
  ]);
  const references = [
    ...parsed.zhin.features.map((reference) => ({ field: 'features', name: reference.package })),
    ...parsed.zhin.plugins.map((reference) => ({ field: 'plugins', name: reference.package })),
  ];
  for (const reference of references) {
    if (reference.name.startsWith('./')) continue;
    if (!declared.has(reference.name)) {
      problems.errors.push(`zhin.${reference.field} 引用了 ${reference.name}，但未在 dependencies / peerDependencies 中声明（Runtime 会拒绝加载）`);
    }
  }
}

/** peerDependencies policy and ranges. */
export function checkPeerDependencies(
  pluginDirectory: string,
  manifest: Record<string, unknown>,
  problems: PluginCheckProblems,
): void {
  const peers = stringRecord(manifest.peerDependencies);
  const dependencies = stringRecord(manifest.dependencies);

  if (!('zhin.js' in peers)) {
    problems.warnings.push('peerDependencies 未声明 zhin.js：插件应与宿主共用一份 zhin.js（参照 zhin new 生成的清单）');
  }
  for (const name of Object.keys(dependencies).filter(isZhinStackPackage)) {
    if (name in peers) continue;
    problems.warnings.push(`${name} 写在 dependencies 中：Zhin 栈应放在 peerDependencies（开发时同时写进 devDependencies），否则宿主可能装出两份`);
  }

  for (const [name, range] of Object.entries(peers)) {
    const trimmed = range.trim();
    if (LOOSE_RANGES.has(trimmed)) {
      problems.errors.push(`peerDependencies.${name} 为 "${range}"：请写真实的 semver 范围（如 ^1.0.0），pnpm 不接受 peer 为 latest`);
      continue;
    }
    if (trimmed.startsWith('workspace:')) {
      problems.warnings.push(`peerDependencies.${name} 为 ${range}：只有 pnpm publish 会改写 workspace: 协议，npm publish 不会`);
      continue;
    }
    if (PROTOCOL_PREFIXES_THAT_DO_NOT_PUBLISH.some((prefix) => trimmed.startsWith(prefix))) {
      problems.errors.push(`peerDependencies.${name} 为 ${range}：本地协议发布后无法解析`);
      continue;
    }
    if (semver.validRange(trimmed) === null) {
      problems.errors.push(`peerDependencies.${name} 不是有效的 semver 范围：${range}`);
      continue;
    }
    const installed = findInstalledVersion(name, pluginDirectory);
    if (installed && semver.valid(installed) && !semver.satisfies(installed, trimmed, { includePrerelease: true })) {
      problems.warnings.push(`peerDependencies.${name} 为 ${range}，但本地安装的是 ${installed}：测试用的版本不在声明范围内`);
    }
  }
}
