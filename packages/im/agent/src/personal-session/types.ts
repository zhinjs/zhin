import type { ConversationRef } from '@zhin.js/im-contract';

/** Constructed by a trusted ingress from its authenticated platform identity. */
export interface PersonalSessionAddress {
  readonly rootId: string;
  readonly platform: string;
  /** Trusted origin.endpoint: the concrete account instance, not its capability entry id. */
  readonly endpoint: string;
  readonly conversation: ConversationRef;
  readonly subjectId: string;
}

/** Authenticated caller identity; never derive this from a client session key. */
export interface PersonalSessionOwner {
  readonly rootId: string;
  readonly platform: string;
  readonly endpoint: string;
  /** Canonical adapter capability entry id from ConversationRef.endpoint.id. */
  readonly adapterId: string;
  readonly subjectId: string;
}

export interface PersonalSessionIdentity {
  readonly key: string;
  readonly sceneKey: string;
  readonly address: PersonalSessionAddress;
  readonly owner: PersonalSessionOwner;
}

export type PersonalSessionSelection =
  | Readonly<{ kind: 'preset'; presetId: string }>
  | Readonly<{ kind: 'inherit' }>;

/** Stores a preset reference only; provider configuration and credentials live elsewhere. */
export interface PersonalSessionState {
  readonly identity: PersonalSessionIdentity;
  readonly revision: number;
  readonly selection: PersonalSessionSelection;
}

export interface PersonalSessionAccess {
  readonly address: PersonalSessionAddress;
  readonly owner: PersonalSessionOwner;
}

export interface PersonalSessionSelectionCommand extends PersonalSessionAccess {
  readonly expectedRevision: number;
  readonly selection: PersonalSessionSelection;
}
