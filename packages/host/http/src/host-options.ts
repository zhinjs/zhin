import type { TokenRegistry } from './token-registry.js';

export interface HttpHostAddress {
  readonly host: string;
  readonly port: number;
  readonly protocol: 'http' | 'https';
  readonly secure: boolean;
  readonly origin: string;
}

type TlsMaterial = string | Uint8Array | ReadonlyArray<string | Uint8Array | { readonly pem: string | Uint8Array; readonly passphrase?: string }>;

export interface HttpHostTlsOptions {
  readonly key: TlsMaterial;
  readonly cert: TlsMaterial;
  readonly ca?: string | Uint8Array | ReadonlyArray<string | Uint8Array>;
  readonly passphrase?: string;
  readonly minVersion?: 'TLSv1.3' | 'TLSv1.2' | 'TLSv1.1' | 'TLSv1';
  readonly ciphers?: string;
}

/** Listener configuration (`http.*`) for the in-process Node server and the gateway. */
export interface HttpHostOptions {
  readonly host?: string;
  readonly port?: number;
  /** Bootstrap Bearer token (`http.token`), accepted only until the first owner exists. */
  readonly token?: string;
  /** CORS allowlist; always merged with Remote Console origin. */
  readonly corsOrigins?: readonly string[];
  /**
   * Paths under this prefix require Bearer auth when a token registry is configured.
   * Defaults to `/api`. `/pub/*`, Console shell, and page routes stay public.
   */
  readonly apiBase?: string;
  /** Extra HTTP path prefixes that skip auth even under `apiBase`. */
  readonly authExemptPaths?: readonly string[];
  /** Enables HTTPS and WSS on this listener. Certificate lifecycle belongs to the process composition root. */
  readonly tls?: HttpHostTlsOptions;
  /** @internal Shared registry for listener groups; `token` is ignored when set. */
  readonly tokenRegistry?: TokenRegistry;
}
