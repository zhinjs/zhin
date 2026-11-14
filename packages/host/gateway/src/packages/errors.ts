import type { GatewayRpcErrorCode, GatewayRpcErrorDetails } from '@zhin.js/console-protocol';

const STATUS: Readonly<Record<GatewayRpcErrorCode, number>> = {
  invalid_input: 400,
  forbidden: 403,
  unmapped: 403,
  unknown_rpc: 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

/** Transport-independent gateway error raised before a transaction does any work. */
export class GatewayError extends Error {
  readonly status: number;
  /** Structured details sent with the reply (only non-empty fields). */
  readonly details?: GatewayRpcErrorDetails;
  constructor(readonly code: GatewayRpcErrorCode, message: string, options?: ErrorOptions & { readonly details?: GatewayRpcErrorDetails }) {
    super(message, options);
    this.name = 'GatewayError';
    this.status = STATUS[code];
    const details = options?.details;
    const errors = details?.errors?.length ? Object.freeze(details.errors.map(item => Object.freeze({ path: item.path, message: item.message }))) : undefined;
    const missingEnv = details?.missingEnv?.length ? Object.freeze([...details.missingEnv]) : undefined;
    if (errors || missingEnv) this.details = Object.freeze({ ...(errors ? { errors } : {}), ...(missingEnv ? { missingEnv } : {}) });
  }
}
