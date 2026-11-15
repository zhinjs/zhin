/**
 * ADR 0062 §23 / Q23: group interjection ("插话", ambient engagement) is a feature in the layered
 * feature overrides (ADR 0050 / 0055). The global default stays `ai.trigger.ambient` in the
 * configuration file; adapter / endpoint / conversation switches are stored in `feature_overrides`
 * under the reserved feature id {@link AMBIENT_FEATURE_ID} (not a Plugin instance path, so it can
 * never collide with one).
 *
 * Stored row shape: `enabled: false` switches interjection off at that level and locks the levels
 * below (as for Plugins); `patch.engage === true` switches it on there (needed because the global
 * default is off for conversations outside `ai.trigger.ambient.conversations`).
 */
import {
  parseFeatureResolutionKey,
  readFeatureConversationOverrides,
  resolveEndpointFeatureKey,
  type FeatureConfigLevel,
  type FeatureConversationOverride,
  type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';

/** Reserved feature id of group interjection in the feature override store. @public */
export const AMBIENT_FEATURE_ID = '@ambient';

/** Words that name group interjection in chat feature commands (`功能 关闭 插话`). @public */
export const AMBIENT_FEATURE_WORDS: ReadonlySet<string> = new Set(['插话', '群插话', 'ambient']);

/** Patch field marking an explicit "on" override. @public */
export const AMBIENT_ENGAGE_FIELD = 'engage';

/** Effective interjection switch for one conversation. @public */
export interface AmbientSwitchResolution {
  readonly enabled: boolean;
  /** Level that decided: `global` is the configuration file default. */
  readonly source: FeatureConfigLevel;
  /** Set when an upper level switched it off (lower levels cannot turn it back on). */
  readonly lockedBy?: Exclude<FeatureConfigLevel, 'global' | 'conversation'>;
}

type OverrideReader = { get(plugin: string, key: string): FeatureConversationOverride | undefined };

/** Ancestor keys (adapter, endpoint, conversation) of a resolution key that exist. */
export function ambientScopeKeys(key: string): ReadonlyArray<readonly [Exclude<FeatureConfigLevel, 'global'>, string]> {
  let parsed;
  try { parsed = parseFeatureResolutionKey(key); } catch { return []; }
  if (!parsed.adapter) return [];
  const keys: Array<readonly [Exclude<FeatureConfigLevel, 'global'>, string]> = [['adapter', parsed.adapter]];
  if (parsed.endpointId !== undefined) keys.push(['endpoint', `${parsed.adapter}/${parsed.endpointId}`]);
  if (parsed.conversation !== undefined) keys.push(['conversation', key]);
  return keys;
}

/** Resolves the switch from stored overrides at `key` on top of the file default `globalEnabled`. @public */
export function resolveAmbientSwitchAt(
  reader: OverrideReader | undefined,
  key: string | undefined,
  globalEnabled: boolean,
  level?: Exclude<FeatureConfigLevel, 'global'>,
): AmbientSwitchResolution {
  if (!reader || !key) return Object.freeze({ enabled: globalEnabled, source: 'global' as const });
  let on: FeatureConfigLevel | undefined;
  for (const [scopeLevel, scopeKey] of ambientScopeKeys(key)) {
    const row = reader.get(AMBIENT_FEATURE_ID, scopeKey);
    if (row?.enabled === false) {
      const locks = scopeLevel !== 'conversation' && level !== undefined && scopeLevel !== level;
      return Object.freeze({ enabled: false, source: scopeLevel,
        ...(locks ? { lockedBy: scopeLevel as Exclude<FeatureConfigLevel, 'global' | 'conversation'> } : {}) });
    }
    if (row?.patch?.[AMBIENT_ENGAGE_FIELD] === true) on = scopeLevel;
  }
  return Object.freeze(on ? { enabled: true, source: on } : { enabled: globalEnabled, source: 'global' as const });
}

/**
 * Whether interjection is on for a message's conversation in this generation: the stored
 * overrides on top of `globalEnabled` (the file allowlist `ai.trigger.ambient.conversations`).
 * @public
 */
export function resolveAmbientSwitch(
  snapshot: Pick<RuntimeSnapshot, 'root' | 'resources' | 'projections' | 'tree'> | undefined,
  message: Readonly<{ conversation: Readonly<{ endpoint: Readonly<{ id: string }>; kind: string; id: string }>; endpointId?: string }>,
  globalEnabled: boolean,
): AmbientSwitchResolution {
  if (!snapshot) return Object.freeze({ enabled: globalEnabled, source: 'global' as const });
  let key: string | undefined;
  try {
    key = resolveEndpointFeatureKey(snapshot, String(message.conversation.endpoint.id), message.endpointId,
      { kind: message.conversation.kind, id: message.conversation.id });
  } catch { key = undefined; }
  return resolveAmbientSwitchAt(readFeatureConversationOverrides(snapshot), key, globalEnabled);
}
