import type { LayoutManifest } from './layout.js';
import type { NavNode } from './navigation.js';
import type { PageManifest } from './page.js';

/** The two optional layout slots resolved for a concrete page route. */
export interface ConsoleLayoutSlots {
  readonly nav?: Readonly<LayoutManifest>;
  readonly footer?: Readonly<LayoutManifest>;
}

/**
 * A route result that is safe to return to a Console client.
 *
 * Forbidden routes intentionally omit their page manifest, so an access check
 * cannot be used to enumerate otherwise hidden page metadata.
 */
export type ConsoleRouteResolution =
  | {
    readonly status: 'found';
    readonly page: Readonly<PageManifest>;
    readonly layouts: Readonly<ConsoleLayoutSlots>;
  }
  | { readonly status: 'forbidden' }
  | { readonly status: 'missing' };

/**
 * A generation-bound view of the Console. Call `resolve()` only while the
 * originating ConsoleRuntime view lease is active.
 */
export interface ConsoleTopology {
  readonly generation: number;
  readonly pages: readonly Readonly<PageManifest>[];
  readonly navigation: readonly Readonly<NavNode>[];
  resolve(path: string): Readonly<ConsoleRouteResolution>;
}

/** JSON shape returned by a Host topology query. */
export interface ConsoleTopologyResponse {
  readonly generation: number;
  readonly pages: readonly Readonly<PageManifest>[];
  readonly navigation: readonly Readonly<NavNode>[];
  readonly route?: string;
  readonly resolution?: Readonly<ConsoleRouteResolution>;
}
