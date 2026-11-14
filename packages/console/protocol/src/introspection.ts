/**
 * Rows of the runtime introspection pages (`GET {base}/introspection/<kind>`, `STATUS_VIEW`).
 *
 * Every capability row may name the plugin that owns it (#1250): `pluginInstance` is the plugin
 * instance key in the running generation (the key under `plugins:` in the project config) and
 * `pluginPackage` the npm package it was loaded from. Both are optional — a row whose owner left
 * the generation, or a row from an older instance, has neither — so the Console groups by plugin
 * when they are present and falls back to the source path otherwise.
 */
export interface ConsoleIntrospectionOwner {
  /** Opaque owner id inside the generation; stable only within that generation. */
  readonly owner?: string;
  /** Plugin instance key of the owner, e.g. `reminder` or `adapter-icqq`. */
  readonly pluginInstance?: string;
  /** npm package name of the owner, e.g. `@zhin.js/adapter-icqq`. */
  readonly pluginPackage?: string;
}

export interface ConsoleIntrospectionCommandParameter {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly optional: boolean;
  readonly rest: boolean;
  readonly description: string;
  readonly default?: unknown;
  readonly defaultKind?: 'literal' | 'dynamic';
}

export interface ConsoleIntrospectionCommand extends ConsoleIntrospectionOwner {
  readonly pattern: string;
  readonly desc: string;
  /**
   * Source file of the command, project-relative. Kept under its historical name; it is a path,
   * not the plugin — use `pluginInstance` / `pluginPackage` for that.
   */
  readonly plugin: string;
  readonly parameters: readonly ConsoleIntrospectionCommandParameter[];
  readonly aliases: readonly string[];
  readonly permissions: readonly string[];
  readonly shortcuts: readonly string[];
}

export interface ConsoleIntrospectionMiddleware extends ConsoleIntrospectionOwner {
  readonly name: string;
  readonly owner: string;
  readonly phase: string;
  readonly target: string;
  readonly order?: number;
  readonly source: string;
}

export interface ConsoleIntrospectionComponent extends ConsoleIntrospectionOwner {
  readonly name: string;
  readonly owner: string;
  readonly source: string;
  readonly previewProps?: unknown;
}

export interface ConsoleIntrospectionTool extends ConsoleIntrospectionOwner {
  readonly name: string;
  readonly source: string;
  readonly description: string;
}

export interface ConsoleIntrospectionPromptSection extends ConsoleIntrospectionOwner {
  readonly name: string;
  readonly qualifiedName: string;
  readonly title: string;
  readonly owner: string;
  readonly layer: string;
  readonly order: number;
  readonly retention: string;
  readonly maxChars?: number;
  readonly profiles: readonly string[];
  readonly platforms?: readonly string[];
  readonly source: string;
  readonly generation: number;
  readonly contentChars: number;
}
