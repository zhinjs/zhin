import {
  createToken,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
} from '@zhin.js/plugin-runtime';
import type { Message } from './contracts.js';

/** Generation-owned hooks before ordinary dispatch and after it misses. */
export interface IngressRoute {
  preRoute?(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
  shouldRouteBeforeDispatch?(message: Message): boolean;
  route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
}

export const ingressRouteToken = createToken<IngressRoute>('zhin.im.ingress-route');

export function resolveIngressRoute(snapshot: RuntimeSnapshot): IngressRoute | undefined {
  const candidate = snapshot.resources.get(snapshot.root)?.get(ingressRouteToken.id);
  return candidate
    && typeof candidate === 'object'
    && typeof (candidate as IngressRoute).route === 'function'
    ? candidate as IngressRoute
    : undefined;
}
