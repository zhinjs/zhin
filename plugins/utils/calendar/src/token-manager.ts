/**
 * In-memory OAuth access-token cache with proactive refresh, single-flight,
 * refresh-token rotation handling, and clear invalid_grant errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type OAuthProviderKind = "google" | "microsoft";

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch ms when the access token expires. */
  readonly expiresAt: number;
}

export interface TokenManagerLogger {
  warn(message: string): void;
}

/** Persistent storage for the refresh token (e.g. zhin plugin database state). */
export interface RefreshTokenStore {
  load(): Promise<string | undefined>;
  save(refreshToken: string): Promise<void>;
}

export type AuthorizationLostListener = (
  provider: OAuthProviderKind,
  message: string
) => void | Promise<void>;

/** Chat command that (re-)authorizes a provider; shown in user-facing errors. */
export function authCommandFor(provider: OAuthProviderKind, commandHead?: string): string | undefined {
  return commandHead ? `${commandHead} ${provider}` : undefined;
}

export interface TokenManagerOptions {
  readonly provider: OAuthProviderKind;
  readonly clientId: string;
  /** Optional for Microsoft public/native clients. Required for Google. */
  readonly clientSecret?: string;
  readonly tenant?: string;
  /** Fallback refresh token from config/env; the token store wins when it has a value. */
  readonly initialRefreshToken?: string;
  /** Refresh token persisted by the chat authorization flow. */
  readonly tokenStore?: RefreshTokenStore;
  /** Called once when the refresh token is rejected (invalid_grant). */
  readonly onAuthorizationLost?: AuthorizationLostListener;
  /**
   * Optional path to persist rotated refresh tokens (JSON).
   * When unset, rotation only logs a warning (update env manually).
   */
  readonly tokenFile?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: TokenManagerLogger;
  /** Refresh this many ms before expiry. Default 5 minutes. */
  readonly skewMs?: number;
}

export class OAuthTokenError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OAuthTokenError";
    this.code = code;
  }
}

interface TokenFilePayload {
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
}

const DEFAULT_SKEW_MS = 5 * 60 * 1000;

export class OAuthTokenManager {
  readonly #provider: OAuthProviderKind;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #tenant: string;
  readonly #tokenFile: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #logger: TokenManagerLogger;
  readonly #skewMs: number;
  #refreshToken: string;
  #accessToken = "";
  #expiresAt = 0;
  #inflight: Promise<string> | undefined;
  readonly #tokenStore: RefreshTokenStore | undefined;
  readonly #onAuthorizationLost: AuthorizationLostListener | undefined;
  #authorizationLostMessage = "";

  constructor(options: TokenManagerOptions) {
    if (!options.clientId.trim()) {
      throw new OAuthTokenError(
        "config",
        `${options.provider}: 缺少 client_id`
      );
    }
    if (options.provider === "google" && !options.clientSecret?.trim()) {
      throw new OAuthTokenError("config", "google: 缺少 client_secret");
    }
    this.#provider = options.provider;
    this.#clientId = options.clientId.trim();
    this.#clientSecret = (options.clientSecret ?? "").trim();
    this.#tenant = (options.tenant ?? "common").trim() || "common";
    this.#tokenFile = (options.tokenFile ?? "").trim();
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#logger = options.logger ?? {
      warn: (message) => console.warn(message),
    };
    this.#skewMs = options.skewMs ?? DEFAULT_SKEW_MS;
    this.#refreshToken = (options.initialRefreshToken ?? "").trim();
    this.#tokenStore = options.tokenStore;
    this.#onAuthorizationLost = options.onAuthorizationLost;
  }

  get provider(): OAuthProviderKind {
    return this.#provider;
  }

  /** Whether a refresh token is available (stored or from config). */
  get hasRefreshToken(): boolean {
    return this.#refreshToken !== "";
  }

  /** Whether the last refresh attempt was rejected with invalid_grant. */
  get authorizationLost(): boolean {
    return this.#authorizationLostMessage !== "";
  }

  /**
   * Loads persisted tokens: token_file overlay first, then the token store,
   * which takes precedence over config/env because it is written by chat auth.
   */
  async hydrate(): Promise<void> {
    await this.hydrateFromFile();
    if (!this.#tokenStore) {
      return;
    }
    const storedRefreshToken = (await this.#tokenStore.load())?.trim() ?? "";
    if (storedRefreshToken) {
      this.#refreshToken = storedRefreshToken;
    }
  }

  /** Replaces the refresh token after a successful chat authorization. */
  setRefreshToken(refreshToken: string): void {
    this.#refreshToken = refreshToken.trim();
    this.#accessToken = "";
    this.#expiresAt = 0;
    this.#authorizationLostMessage = "";
  }

  /** Forgets all tokens held in memory (used by `calendar logout`). */
  clearTokens(): void {
    this.setRefreshToken("");
  }

  /** Current refresh token (may change after Microsoft rotation). */
  get refreshToken(): string {
    return this.#refreshToken;
  }

  /** Load optional token file overlay (rotated refresh / cached access). */
  async hydrateFromFile(): Promise<void> {
    if (!this.#tokenFile) return;
    try {
      const raw = await readFile(this.#tokenFile, "utf8");
      const data = JSON.parse(raw) as TokenFilePayload;
      if (typeof data.refresh_token === "string" && data.refresh_token.trim()) {
        this.#refreshToken = data.refresh_token.trim();
      }
      if (
        typeof data.access_token === "string" &&
        data.access_token.trim() &&
        typeof data.expires_at === "number" &&
        data.expires_at > this.#now() + this.#skewMs
      ) {
        this.#accessToken = data.access_token.trim();
        this.#expiresAt = data.expires_at;
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        this.#logger.warn(
          `[calendar] 读取 token_file 失败：${this.#tokenFile}（${
            err.message
          }）`
        );
      }
    }
  }

  async getAccessToken(): Promise<string> {
    if (this.#accessToken && this.#now() < this.#expiresAt - this.#skewMs) {
      return this.#accessToken;
    }
    return this.#refreshSingleFlight();
  }

  /** Bypass cache (e.g. after HTTP 401). Still single-flight. */
  async forceRefresh(): Promise<string> {
    this.#expiresAt = 0;
    this.#accessToken = "";
    return this.#refreshSingleFlight();
  }

  #refreshSingleFlight(): Promise<string> {
    if (this.#inflight) return this.#inflight;
    this.#inflight = this.#refresh().finally(() => {
      this.#inflight = undefined;
    });
    return this.#inflight;
  }

  async #refresh(): Promise<string> {
    if (this.#authorizationLostMessage) {
      throw new OAuthTokenError(
        "invalid_grant",
        this.#authorizationLostMessage
      );
    }
    if (!this.#refreshToken) {
      throw new OAuthTokenError(
        "not_authorized",
        `${
          this.#provider
        }: 日历尚未授权。请 master 通过日历授权入口完成授权。`
      );
    }
    const body = new URLSearchParams({
      client_id: this.#clientId,
      refresh_token: this.#refreshToken,
      grant_type: "refresh_token",
    });
    if (this.#clientSecret) body.set("client_secret", this.#clientSecret);
    if (this.#provider === "microsoft") {
      body.set("scope", "offline_access Calendars.ReadWrite User.Read");
    }

    const url =
      this.#provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : `https://login.microsoftonline.com/${this.#tenant}/oauth2/v2.0/token`;

    const response = await this.#fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      const errCode = String(data.error ?? "");
      const errDesc = String(data.error_description ?? text.slice(0, 200));
      if (errCode === "invalid_grant" || /invalid_grant/i.test(errDesc)) {
        const message = `${
          this.#provider
        }: 日历授权已失效或被撤销（invalid_grant）。请 master 通过日历授权入口重新授权。详情：${errDesc}`;
        this.#authorizationLostMessage = message;
        await this.#notifyAuthorizationLost(message);
        throw new OAuthTokenError("invalid_grant", message);
      }
      throw new OAuthTokenError(
        errCode || "http_error",
        `${this.#provider}: token 刷新失败 HTTP ${response.status}：${
          errDesc || response.statusText
        }`
      );
    }

    const accessToken = String(data.access_token ?? "");
    if (!accessToken) {
      throw new OAuthTokenError(
        "response",
        `${this.#provider}: 刷新响应缺少 access_token`
      );
    }
    const expiresIn = Number(data.expires_in ?? 3600);
    this.#accessToken = accessToken;
    this.#expiresAt = this.#now() + Math.max(60, expiresIn) * 1000;

    const rotated =
      typeof data.refresh_token === "string" ? data.refresh_token.trim() : "";
    if (rotated && rotated !== this.#refreshToken) {
      this.#refreshToken = rotated;
      if (this.#tokenStore) {
        await this.#tokenStore.save(rotated);
        this.#logger.warn(
          `[calendar] ${
            this.#provider
          }: 提供方返回了新的 refresh_token，已写入插件数据库`
        );
      } else if (this.#tokenFile) {
        await this.#persist();
        this.#logger.warn(
          `[calendar] ${
            this.#provider
          }: 提供方返回了新的 refresh_token，已写入 token_file：${
            this.#tokenFile
          }`
        );
      } else {
        this.#logger.warn(
          `[calendar] ${
            this.#provider
          }: 提供方返回了新的 refresh_token。请立刻更新环境变量中的 refresh_token（当前未配置 token_file，内存中的新值进程重启后会丢失）：\n${rotated}`
        );
      }
    } else if (this.#tokenFile) {
      await this.#persist();
    }

    return this.#accessToken;
  }

  async #notifyAuthorizationLost(message: string): Promise<void> {
    if (!this.#onAuthorizationLost) {
      return;
    }
    try {
      await this.#onAuthorizationLost(this.#provider, message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#logger.warn(`[calendar] 授权失效通知发送失败：${reason}`);
    }
  }

  async #persist(): Promise<void> {
    if (!this.#tokenFile) return;
    const payload: TokenFilePayload = {
      refresh_token: this.#refreshToken,
      access_token: this.#accessToken || undefined,
      expires_at: this.#expiresAt || undefined,
    };
    await mkdir(path.dirname(this.#tokenFile), { recursive: true });
    await writeFile(
      this.#tokenFile,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8"
    );
  }
}
