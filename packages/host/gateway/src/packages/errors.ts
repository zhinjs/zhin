import type { GatewayRpcErrorCode } from '@zhin.js/console-protocol';

const STATUS: Readonly<Record<GatewayRpcErrorCode, number>> = {
  invalid_input: 400,
  forbidden: 403,
  unmapped: 403,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

/** Transport-independent gateway error raised before a transaction does any work. */
export class GatewayError extends Error {
  readonly status: number;
  constructor(readonly code: GatewayRpcErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GatewayError';
    this.status = STATUS[code];
  }
}
