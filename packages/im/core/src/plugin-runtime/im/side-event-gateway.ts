import { createToken } from '@zhin.js/plugin-runtime';
import type { Notice } from '../../notice.js';
import type { Request } from '../../request.js';
import type { SystemEvent } from '../../system-event.js';

/**
 * Plugin Runtime 侧事件入站口（与 messageGatewayToken 并列）。
 * 适配器归一 Notice / Request / SystemEvent 后调用，由 ImRuntime 分发给 HandlerIndex。
 */
export interface SideEventGateway {
  receiveNotice(notice: Notice): Promise<void>;
  receiveRequest(request: Request): Promise<void>;
  receiveSystem(event: SystemEvent): Promise<void>;
}

export const sideEventGatewayToken = createToken<SideEventGateway>('zhin.im.side-event-gateway');
