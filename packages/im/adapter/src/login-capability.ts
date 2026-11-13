/**
 * Login capability declaration and the optional Endpoint login control port (ADR 0058).
 *
 * `defineAdapter({ login })` declares how an Adapter logs in; absence means the Console offers no
 * login actions for it. The Endpoint may additionally expose `login` hooks (`relogin`,
 * `refreshChallenge`) that the Console reaches through a generation-scoped port.
 * @module @zhin.js/adapter
 */

/**
 * - `interactive`: a person answers challenges (QR code, SMS, slider, device lock …) through LoginAssist.
 * - `credential`: configured credentials (token, app secret …); a challenge can only be credential provisioning.
 * - `external`: login happens in another program (NapCat, Lagrange, Satori server …); Zhin only connects.
 */
export type AdapterLoginMode = 'interactive' | 'credential' | 'external';

/** Kind of one login challenge (Console icon and order only; never platform semantics). */
export type LoginChallengeKind =
  | 'qrcode' | 'link_verify' | 'slider' | 'sms' | 'device' | 'auth' | 'confirm' | 'other';

export const LOGIN_CHALLENGE_KINDS: readonly LoginChallengeKind[] = Object.freeze([
  'qrcode', 'link_verify', 'slider', 'sms', 'device', 'auth', 'confirm', 'other',
]);

const LOGIN_MODES: readonly AdapterLoginMode[] = ['interactive', 'credential', 'external'];

export interface AdapterLoginDeclaration {
  readonly mode: AdapterLoginMode;
  /** Challenge kinds the Adapter may raise (documentation and Console hints). */
  readonly challenges?: readonly LoginChallengeKind[];
  /** The Endpoint implements `login.relogin` and the Console may ask for a fresh login. */
  readonly relogin?: boolean;
  /** The Endpoint implements `login.refreshChallenge` (e.g. a new QR code). */
  readonly refreshQr?: boolean;
}

/** Optional caller lifetime for login control calls. */
export interface EndpointLoginRequest {
  readonly signal?: AbortSignal;
}

/**
 * Login control hooks one Endpoint may implement (`createEndpointSpecification(client, { login })`).
 * Both start work and return once it is started; the result arrives through the login flow.
 */
export interface EndpointLoginControl {
  relogin?(request: EndpointLoginRequest): Promise<void>;
  refreshChallenge?(request: EndpointLoginRequest): Promise<void>;
}

/** @internal Validates the `login` field of an Adapter definition. */
export function normalizeLoginDeclaration(
  value: AdapterLoginDeclaration | undefined,
): AdapterLoginDeclaration | undefined {
  if (value === undefined) return undefined;
  const invalid = (why: string) => new TypeError(`Adapter login ${why}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('must be an object');
  if (!LOGIN_MODES.includes(value.mode)) throw invalid("mode must be 'interactive', 'credential' or 'external'");
  if (value.challenges !== undefined && (!Array.isArray(value.challenges)
    || value.challenges.some((kind) => !LOGIN_CHALLENGE_KINDS.includes(kind)))) {
    throw invalid(`challenges must be a list of ${LOGIN_CHALLENGE_KINDS.join(', ')}`);
  }
  if (value.relogin !== undefined && typeof value.relogin !== 'boolean') throw invalid('relogin must be a boolean');
  if (value.refreshQr !== undefined && typeof value.refreshQr !== 'boolean') throw invalid('refreshQr must be a boolean');
  return Object.freeze({
    mode: value.mode,
    ...(value.challenges ? { challenges: Object.freeze([...new Set(value.challenges)]) } : {}),
    ...(value.relogin !== undefined ? { relogin: value.relogin } : {}),
    ...(value.refreshQr !== undefined ? { refreshQr: value.refreshQr } : {}),
  });
}
