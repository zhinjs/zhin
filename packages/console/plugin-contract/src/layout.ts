export type LayoutSlot = 'nav' | 'footer';

export interface LayoutManifest {
  readonly id: string;
  readonly owner: string;
  readonly slot: LayoutSlot;
  readonly source: string;
  readonly module: string;
  readonly hash: string;
}

export interface NavSlotProps {
  readonly tree: readonly NavNode[];
  readonly current?: string;
  navigate(path: string): void;
}

export interface FooterSlotProps {
  readonly owner: string;
  readonly route?: string;
}

import type { NavNode } from './navigation.js';
