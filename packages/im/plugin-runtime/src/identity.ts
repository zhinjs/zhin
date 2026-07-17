declare const tokenIdBrand: unique symbol;
declare const pluginIdBrand: unique symbol;
declare const featureIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;

export type TokenId = string & { readonly [tokenIdBrand]: true };
export type PluginId = string & { readonly [pluginIdBrand]: true };
export type FeatureId = string & { readonly [featureIdBrand]: true };
export type CapabilityId = string & { readonly [capabilityIdBrand]: true };

const namespacePattern = /^[a-z][a-z0-9.-]*$/;
const localNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const capabilityLocalSegment = String.raw`(?:[a-z0-9][a-z0-9-]*|\$[a-z][a-zA-Z0-9]*)`;
const capabilityLocalNamePattern = new RegExp(
  `^${capabilityLocalSegment}(?:/${capabilityLocalSegment})*$`,
);

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

export function capabilityId(
  owner: PluginId,
  feature: FeatureId,
  localName: string,
): CapabilityId {
  if (!capabilityLocalNamePattern.test(localName)) {
    throw new TypeError(`Invalid capability local name: ${localName}`);
  }
  return `${owner}\0${feature}\0${localName}` as CapabilityId;
}
