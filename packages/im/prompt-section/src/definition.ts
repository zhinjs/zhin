const promptSectionBrand = 'zhin.agent-prompt-section/1' as const;

export type PromptSectionLayer =
  | 'system'
  | 'role'
  | 'task'
  | 'context'
  | 'tools'
  | 'safety'
  | 'constraints'
  | 'examples'
  | 'memory';

export type PromptSectionRetention = 'required' | 'preferred' | 'opportunistic';
export type PromptProfile = 'interactive' | 'schedule';

export interface AgentPromptSectionDefinition {
  readonly $feature: typeof promptSectionBrand;
  readonly title: string;
  readonly content: string;
  readonly layer: PromptSectionLayer;
  readonly order: number;
  readonly retention: PromptSectionRetention;
  readonly maxChars?: number;
  readonly profiles: readonly PromptProfile[];
  readonly platforms?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AgentPromptSectionInput = Omit<
  AgentPromptSectionDefinition,
  '$feature' | 'layer' | 'order' | 'retention' | 'profiles'
> & Partial<Pick<
  AgentPromptSectionDefinition,
  'layer' | 'order' | 'retention' | 'profiles'
>>;

declare module '@zhin.js/plugin-runtime' {
  // Type parameter name must match the base PluginSetupContext declaration (TS2428).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginSetupContext<TConfig = unknown> {
    addPromptSection(localName: string, definition: AgentPromptSectionDefinition): void;
  }
}

export function defineAgentPromptSection(
  input: AgentPromptSectionInput,
): Readonly<AgentPromptSectionDefinition> {
  if (!input.title?.trim()) throw new TypeError('Prompt Section title cannot be empty');
  if (!input.content?.trim()) throw new TypeError('Prompt Section content cannot be empty');
  const layer = input.layer ?? 'context';
  if (!LAYERS.has(layer)) throw new TypeError(`Invalid Prompt Section layer: ${String(layer)}`);
  const order = input.order ?? 50;
  if (!Number.isSafeInteger(order)) throw new TypeError('Prompt Section order must be a safe integer');
  const retention = input.retention ?? 'preferred';
  if (!RETENTIONS.has(retention)) {
    throw new TypeError(`Invalid Prompt Section retention: ${String(retention)}`);
  }
  if (input.maxChars !== undefined && (!Number.isSafeInteger(input.maxChars) || input.maxChars <= 0)) {
    throw new TypeError('Prompt Section maxChars must be a positive safe integer');
  }
  const profiles = input.profiles ?? ['interactive'];
  if (!Array.isArray(profiles) || profiles.length === 0 || profiles.some((profile) => !PROFILES.has(profile))) {
    throw new TypeError('Prompt Section profiles must contain interactive or schedule');
  }
  if (new Set(profiles).size !== profiles.length) {
    throw new TypeError('Prompt Section profiles cannot contain duplicates');
  }
  const platforms = input.platforms?.map((platform) => platform.trim());
  if (platforms && (platforms.length === 0
    || platforms.some((platform) => !platform)
    || new Set(platforms).size !== platforms.length)) {
    throw new TypeError('Prompt Section platforms must contain unique non-empty names');
  }
  if (input.metadata !== undefined
    && (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata))) {
    throw new TypeError('Prompt Section metadata must be an object');
  }
  return Object.freeze({
    ...input,
    $feature: promptSectionBrand,
    title: input.title.trim(),
    content: input.content.trim(),
    layer,
    order,
    retention,
    profiles: Object.freeze([...profiles]),
    ...(platforms ? { platforms: Object.freeze(platforms) } : {}),
    ...(input.metadata ? { metadata: Object.freeze({ ...input.metadata }) } : {}),
  });
}

export function parseAgentPromptSectionDefinition(value: unknown): AgentPromptSectionDefinition {
  if (!value || typeof value !== 'object') throw invalidPromptSection();
  const definition = value as Partial<AgentPromptSectionDefinition>;
  if (
    definition.$feature !== promptSectionBrand
    || typeof definition.title !== 'string'
    || !definition.title.trim()
    || typeof definition.content !== 'string'
    || !definition.content.trim()
    || !LAYERS.has(definition.layer as PromptSectionLayer)
    || !Number.isSafeInteger(definition.order)
    || !RETENTIONS.has(definition.retention as PromptSectionRetention)
    || (definition.maxChars !== undefined
      && (!Number.isSafeInteger(definition.maxChars) || definition.maxChars <= 0))
    || !Array.isArray(definition.profiles)
    || definition.profiles.length === 0
    || definition.profiles.some((profile) => !PROFILES.has(profile))
    || new Set(definition.profiles).size !== definition.profiles.length
    || (definition.platforms !== undefined
      && (!Array.isArray(definition.platforms)
        || definition.platforms.length === 0
        || definition.platforms.some((platform) => typeof platform !== 'string' || !platform.trim())
        || new Set(definition.platforms).size !== definition.platforms.length))
    || (definition.metadata !== undefined
      && (!definition.metadata || typeof definition.metadata !== 'object' || Array.isArray(definition.metadata)))
  ) throw invalidPromptSection();
  return defineAgentPromptSection({
    title: definition.title,
    content: definition.content,
    layer: definition.layer,
    order: definition.order,
    retention: definition.retention,
    maxChars: definition.maxChars,
    profiles: definition.profiles,
    platforms: definition.platforms,
    metadata: definition.metadata,
  });
}

const LAYERS = new Set<PromptSectionLayer>([
  'system', 'role', 'task', 'context', 'tools', 'safety', 'constraints', 'examples', 'memory',
]);
const RETENTIONS = new Set<PromptSectionRetention>(['required', 'preferred', 'opportunistic']);
const PROFILES = new Set<PromptProfile>(['interactive', 'schedule']);

function invalidPromptSection(): TypeError {
  return new TypeError('Prompt Section module must default-export defineAgentPromptSection(...)');
}
