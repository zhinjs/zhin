export interface PageMetadata {
  readonly title?: string;
  readonly icon?: string;
  readonly order?: number;
  readonly hideInNav?: boolean;
  readonly requiredPermissions?: readonly string[];
  readonly requiredRoles?: readonly string[];
}

export interface NormalizedPageMetadata {
  readonly title: string;
  readonly icon?: string;
  readonly order: number;
  readonly hideInNav: boolean;
  readonly requiredPermissions: readonly string[];
  readonly requiredRoles: readonly string[];
}

export interface ClientModuleArtifact {
  readonly module: string;
  readonly hash: string;
  readonly metadata?: unknown;
}

export function normalizeClientModuleArtifact(
  value: unknown,
  label: string,
): Readonly<ClientModuleArtifact> {
  const input = requireRecord(value, label);
  const module = optionalString(input.module, `${label} module`);
  const hash = optionalString(input.hash, `${label} hash`);
  if (!module || !hash) throw new TypeError(`${label} must include module and hash`);
  return Object.freeze({ module, hash, metadata: input.metadata });
}

export interface PageManifest extends NormalizedPageMetadata {
  readonly id: string;
  readonly owner: string;
  readonly localName: string;
  readonly source: string;
  readonly module: string;
  readonly hash: string;
  readonly route: string;
}

export function definePage(metadata: PageMetadata = {}): Readonly<PageMetadata> {
  return normalizePageInput(metadata);
}

export function normalizePageMetadata(
  localName: string,
  metadata: unknown,
): Readonly<NormalizedPageMetadata> {
  assertPageLocalName(localName);
  const input = metadata === undefined ? {} : requireRecord(metadata, 'Page metadata');
  assertKnownMetadataKeys(input);
  const title = optionalString(input.title, 'Page title') ?? titleFromName(localName);
  const icon = optionalString(input.icon, 'Page icon');
  const order = optionalNumber(input.order, 'Page order') ?? 100;
  const hideInNav = optionalBoolean(input.hideInNav, 'Page hideInNav') ?? false;
  return Object.freeze({
    title,
    icon,
    order,
    hideInNav,
    requiredPermissions: stringList(input.requiredPermissions, 'Page requiredPermissions'),
    requiredRoles: stringList(input.requiredRoles, 'Page requiredRoles'),
  });
}

function assertKnownMetadataKeys(input: Record<string, unknown>): void {
  const known = new Set([
    'title',
    'icon',
    'order',
    'hideInNav',
    'requiredPermissions',
    'requiredRoles',
  ]);
  const unknown = Object.keys(input).filter((key) => !known.has(key)).sort();
  if (unknown.length > 0) throw new TypeError(`Unknown Page metadata: ${unknown.join(', ')}`);
}

export function pageRoute(owner: string, root: string, localName: string): string {
  assertPageLocalName(localName);
  if (owner !== root && !owner.startsWith(`${root}/`)) {
    throw new Error(`Page owner ${owner} is outside Root ${root}`);
  }
  const relative = owner === root ? '' : owner.slice(root.length + 1);
  return `/${relative ? `${relative}/` : ''}p-${localName}`;
}

export function assertPageLocalName(value: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new TypeError(`Invalid Page local name: ${value}`);
  }
}

function normalizePageInput(metadata: PageMetadata): Readonly<PageMetadata> {
  const normalized = normalizePageMetadata('page', metadata);
  return Object.freeze({
    title: metadata.title === undefined ? undefined : normalized.title,
    icon: normalized.icon,
    order: metadata.order === undefined ? undefined : normalized.order,
    hideInNav: metadata.hideInNav === undefined ? undefined : normalized.hideInNav,
    requiredPermissions: normalized.requiredPermissions,
    requiredRoles: normalized.requiredRoles,
  });
}

function titleFromName(name: string): string {
  return name.split('-').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}

function stringList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const result = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new TypeError(`${label} entries must be non-empty strings`);
    return item;
  });
  return Object.freeze([...new Set(result)].sort());
}
