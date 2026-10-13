import { Client, type Config } from '@icqqjs/icqq';

export type IcqqBackgroundOperation = 'sso-heartbeat' | 'login';

/** Own SDK promises also invoked by timers that discard their return value. */
export class ManagedIcqqClient extends Client {
  readonly #onFailure: (operation: IcqqBackgroundOperation, error: unknown) => void;

  constructor(uin: number, config: Config, onFailure: (operation: IcqqBackgroundOperation, error: unknown) => void) {
    super(uin, config);
    this.#onFailure = onFailure;
  }

  override sendSsoHeartBeat(): false | Promise<unknown> {
    const task = super.sendSsoHeartBeat();
    if (task !== false) this.#observe('sso-heartbeat', task);
    return task;
  }

  override login(password?: string | Buffer): Promise<void>;
  override login(uin?: number, password?: string | Buffer): Promise<void>;
  override login(uinOrPassword?: number | string | Buffer, password?: string | Buffer): Promise<void> {
    const task = typeof uinOrPassword === 'number' || password !== undefined
      ? super.login(typeof uinOrPassword === 'number' ? uinOrPassword : undefined, password)
      : super.login(uinOrPassword);
    this.#observe('login', task);
    return task;
  }

  #observe(operation: IcqqBackgroundOperation, task: Promise<unknown>): void {
    // Observe the original promise instead of replacing it: explicit SDK
    // callers still receive the rejection and may fail their own operation.
    void task.catch(error => {
      try {
        this.#onFailure(operation, error);
      } catch {
        try {
          this.logger.error('ICQQ background failure handler failed');
        } catch {
          // The rejection is already observed. A broken diagnostic sink must
          // not create another unhandled promise or expose the error payload.
        }
      }
    });
  }

  cancelReconnect(): void {
    if (!this.login_timer) return;
    clearTimeout(this.login_timer);
    this.login_timer = null;
  }
}
