declare const tokenIdBrand: unique symbol;
declare const pluginIdBrand: unique symbol;
declare const featureIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;

export type TokenId = string & { readonly [tokenIdBrand]: true };
export type PluginId = string & { readonly [pluginIdBrand]: true };
export type FeatureId = string & { readonly [featureIdBrand]: true };
export type CapabilityId = string & { readonly [capabilityIdBrand]: true };

const namespacePattern = /^[a-z][a-z0-9.-]*$/;
/** Plugin instanceKey 仍限 ASCII kebab（配置键 / PluginId 路径段）。 */
const localNamePattern = /^[a-z0-9][a-z0-9-]*$/;
/** 动态参数段（`[name].ts` → `$name`），标识符仍为 ASCII。 */
const dynamicCapabilitySegment = /^\$[a-z][a-zA-Z0-9]*$/u;
/**
 * 静态 Capability / 命令路径段：ASCII kebab 或 snake（Host / agent tools 如 `voice_stt`），
 * 或含非 ASCII 字母的 Unicode 名（如 `赞我`）。
 */
const asciiNameSegment = /^[a-z0-9][a-z0-9_-]*$/u;
const unicodeNameSegment = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

function assertNamespace(value: string, label: string): void {
  if (!namespacePattern.test(value)) {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
}

export function tokenId(value: string): TokenId {
  assertNamespace(value, 'token id');
  return value as TokenId;
}

export function featureId(value: string): FeatureId {
  assertNamespace(value, 'feature id');
  return value as FeatureId;
}

export function rootPluginId(): PluginId {
  return 'root' as PluginId;
}

export function childPluginId(parent: PluginId, instanceKey: string): PluginId {
  if (!localNamePattern.test(instanceKey)) {
    throw new TypeError(`Invalid plugin instance key: ${instanceKey}`);
  }
  return `${parent}/${instanceKey}` as PluginId;
}

/**
 * Capability localName 的单段校验（`/` 分隔前的一段）。
 *
 * - `$name`：动态参数段（ASCII）
 * - ASCII kebab / snake：`hello` / `lottery-today` / `voice_stt`
 * - Unicode 名：须含至少一个非 ASCII 字符，且不得含 ASCII 大写（拉丁仍走 kebab/snake）
 */
export function isCapabilityLocalSegment(segment: string): boolean {
  if (!segment || segment.includes('/') || segment.includes('\0')) return false;
  if (dynamicCapabilitySegment.test(segment)) return true;
  if (asciiNameSegment.test(segment)) return true;
  if (/[A-Z]/.test(segment)) return false;
  if (!/[^\x00-\x7F]/u.test(segment)) return false;
  return unicodeNameSegment.test(segment);
}

export function isCapabilityLocalName(localName: string): boolean {
  if (!localName) return false;
  return localName.split('/').every(isCapabilityLocalSegment);
}

/**
 * Database-safe owner encoding used by process-wide plugin resources.
 *
 * Each path segment is length-prefixed and the final underscore is followed
 * by a resource separator. A parent owner therefore cannot match a child
 * owner merely because their PluginId has a common path prefix.
 */
export function pluginOwnerResourceKey(owner: PluginId): string {
  return `${String(owner)
    .split('/')
    .map((segment) => `${segment.length}_${segment}`)
    .join('_')}_`;
}

export function capabilityId(
  owner: PluginId,
  feature: FeatureId,
  localName: string,
): CapabilityId {
  if (!isCapabilityLocalName(localName)) {
    throw new TypeError(`Invalid capability local name: ${localName}`);
  }
  return `${owner}\0${feature}\0${localName}` as CapabilityId;
}
