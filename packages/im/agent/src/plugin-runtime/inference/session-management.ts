import { resolveProviderProfile, type ProviderRepository } from '@zhin.js/ai/provider';
import {
  freezePersonalSessionSelection,
  personalSessionIdentity,
  personalSessionOwnerId,
  type PersonalSessionService,
  type PersonalSessionOwner,
  type PersonalSessionAddress,
} from '../../personal-session/index.js';
import type { PersonalSessionDirectory } from './session-directory.js';
import { InferenceManagementError, type InferenceManagementPrincipal } from './management.js';

interface SessionManagementOptions {
  readonly rootId: string;
  readonly hostOwnerId: string;
  readonly owners: readonly PersonalSessionOwner[];
  readonly sessions: PersonalSessionService;
  readonly directory: PersonalSessionDirectory;
  readonly repository: ProviderRepository;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InferenceManagementError('invalid-input');
  return value as Record<string, unknown>;
}

/** Console identity binding precedes address lookup, selection validation and persistence. */
export class InferenceSessionManagement {
  readonly #owners: ReadonlyMap<string, PersonalSessionOwner>;
  constructor(private readonly options: SessionManagementOptions) {
    this.#owners = new Map(
      options.owners.map((owner) => {
        if (owner.rootId !== options.rootId)
          throw new Error('Personal Session binding belongs to another Host');
        return [personalSessionOwnerId(owner), owner];
      })
    );
  }
  #owner(principal: InferenceManagementPrincipal): PersonalSessionOwner {
    const owner = this.#owners.get(principal.ownerId);
    if (!owner || principal.hostAdministrator) throw new InferenceManagementError('forbidden');
    return owner;
  }
  #access(principal: InferenceManagementPrincipal, value: unknown) {
    const owner = this.#owner(principal);
    let identity;
    try {
      identity = personalSessionIdentity(value as PersonalSessionAddress);
    } catch {
      throw new InferenceManagementError('invalid-input');
    }
    if (personalSessionOwnerId(identity.owner) !== principal.ownerId)
      throw new InferenceManagementError('forbidden');
    return { owner, address: identity.address };
  }
  async list(
    principal: InferenceManagementPrincipal,
    page: Readonly<{ limit: number; offset: number }>
  ) {
    return this.options.directory(this.#owner(principal), page);
  }
  async read(principal: InferenceManagementPrincipal, address: unknown) {
    const access = this.#access(principal, address);
    return this.options.sessions.read(access);
  }
  async select(principal: InferenceManagementPrincipal, value: unknown) {
    const input = object(value),
      access = this.#access(principal, input.address);
    if (typeof input.expectedRevision !== 'number')
      throw new InferenceManagementError('invalid-input');
    const selection = freezePersonalSessionSelection(
      input.selection as Parameters<typeof freezePersonalSessionSelection>[0]
    );
    if (selection.kind === 'profile') {
      const graph = await this.options.repository.readGraph({
        rootId: this.options.rootId,
      });
      if (!graph) throw new InferenceManagementError('conflict');
      resolveProviderProfile({
        graph,
        context: {
          rootId: this.options.rootId,
          hostOwnerId: this.options.hostOwnerId,
          ownerId: principal.ownerId,
          operationId: 'personal-session-selection',
          sessionChat: selection.profile,
        },
        kind: 'language',
        purpose: 'chat',
      });
    }
    return this.options.sessions.select({
      ...access,
      expectedRevision: input.expectedRevision,
      selection,
    });
  }
}
