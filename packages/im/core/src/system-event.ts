import type { Adapters } from './adapter.js';
import type { SideEventBase } from './side-event/base.js';

/**
 * 系统/登录侧事件（扫码、滑块、掉线等）。
 * `$scene_type`：`login` / `offline` / `online` 等；
 * `$sub_type`：`qrcode` / `slider` / `device` / `kickoff` / `network` 等。
 */
export interface SystemEventBase extends SideEventBase {
  $adapter: keyof Adapters;
  $type: 'system';
}

export type SystemEvent<T extends object = {}> = SystemEventBase & T;

export namespace SystemEvent {
  export function from<T extends object>(input: T, format: SystemEventBase): SystemEvent<T> {
    return Object.assign(input, format);
  }
}
