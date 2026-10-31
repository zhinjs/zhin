export interface RequestMessage {
  readonly type: 'request';
  readonly id: number;
  readonly method: 'prepare' | 'activate' | 'deactivate' | 'call' | 'dispose' | 'control';
  readonly payload?: unknown;
}

export interface ResponseMessage {
  readonly type: 'response';
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: SerializedError;
}

export interface HostCallMessage {
  readonly type: 'host-call';
  readonly id: number;
  readonly method: string;
  readonly input?: unknown;
}

export interface HostResultMessage {
  readonly type: 'host-result';
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: SerializedError;
}

export interface EventMessage {
  readonly type: 'event';
  readonly name: string;
  readonly payload?: unknown;
}

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export type HostMessage = ResponseMessage | HostCallMessage | EventMessage;
/** Cooperative cancellation of one control notification, never a request to terminate the isolate. */
export interface ControlCancelMessage {
  readonly type: 'control-cancel';
  readonly id: number;
  readonly error: SerializedError;
}
export type IsolateMessage = RequestMessage | HostResultMessage | ControlCancelMessage;

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'Error', message: String(error) };
}

export function deserializeError(error?: SerializedError): Error {
  const result = new Error(error?.message ?? 'Unknown isolated runtime error');
  result.name = error?.name ?? 'Error';
  if (error?.stack) result.stack = error.stack;
  return result;
}
