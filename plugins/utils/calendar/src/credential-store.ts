import type { Locale } from 'zhin.js/i18n';
/**
 * Persists OAuth refresh tokens in the plugin's database state (never in .env).
 */
import type { OAuthProviderKind, RefreshTokenStore } from "./token-manager.js";

/** The subset of zhin's PluginStateStore used by the calendar plugin. */
export interface CalendarStateStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: never): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Who completed the chat authorization and where to notify them later. */
export interface CredentialOwner<Target = unknown> {
  readonly sender_id: string;
  /** Fixed when authorization starts; token rotation preserves it. */
  readonly locale?: Locale;
  readonly target: Target;
}

export interface StoredCredential<Target = unknown> {
  readonly refresh_token: string;
  readonly authorized_at: string;
  readonly authorized_by: CredentialOwner<Target> | null;
}

function credentialKey(provider: OAuthProviderKind): string {
  return `oauth/${provider}`;
}

export class CalendarCredentialStore {
  readonly #state: CalendarStateStore;

  constructor(state: CalendarStateStore) {
    this.#state = state;
  }

  async get(
    provider: OAuthProviderKind
  ): Promise<StoredCredential | undefined> {
    const stored = await this.#state.get<StoredCredential>(
      credentialKey(provider)
    );
    if (!stored || typeof stored.refresh_token !== "string") {
      return undefined;
    }
    return stored;
  }

  async save(
    provider: OAuthProviderKind,
    refreshToken: string,
    authorizedBy: CredentialOwner | null
  ): Promise<void> {
    const credential: StoredCredential = {
      refresh_token: refreshToken,
      authorized_at: new Date().toISOString(),
      authorized_by: authorizedBy,
    };
    await this.#state.set(credentialKey(provider), credential as never);
  }

  async delete(provider: OAuthProviderKind): Promise<void> {
    await this.#state.delete(credentialKey(provider));
  }

  /** Adapter for OAuthTokenManager: loads and saves only the refresh token. */
  refreshTokenStore(provider: OAuthProviderKind): RefreshTokenStore {
    return {
      load: async () => {
        const credential = await this.get(provider);
        return credential?.refresh_token;
      },
      save: async (refreshToken) => {
        const existing = await this.get(provider);
        const authorizedBy = existing?.authorized_by ?? null;
        await this.save(provider, refreshToken, authorizedBy);
      },
    };
  }
}
