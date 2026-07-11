import type { Adapter } from '../adapter.js';
import type { Endpoint } from '../endpoint.js';
import { Notice } from '../notice.js';
import type { Plugin } from '../plugin.js';

export type EndpointLifecycleKind = 'connect' | 'disconnect' | 'error';

export interface EndpointLifecyclePayload {
  adapter: string;
  endpointId: string;
  endpoint: Endpoint;
  kind: EndpointLifecycleKind;
  error?: string;
  phase?: string;
  detail?: Record<string, unknown>;
}

/** 可 JSON 序列化的生命周期载荷（不含 endpoint 实例引用） */
export function serializeEndpointLifecyclePayload(
  payload: Pick<
    EndpointLifecyclePayload,
    'adapter' | 'endpointId' | 'kind' | 'error' | 'phase' | 'detail'
  >,
) {
  return {
    adapter: payload.adapter,
    endpointId: payload.endpointId,
    kind: payload.kind,
    error: payload.error,
    phase: payload.phase,
    detail: payload.detail,
  };
}

export async function emitEndpointLifecycle(
  plugin: Plugin,
  adapter: Adapter,
  endpoint: Endpoint,
  kind: EndpointLifecycleKind,
  detail?: { error?: string; phase?: string; detail?: Record<string, unknown> },
): Promise<void> {
  const payload: EndpointLifecyclePayload = {
    adapter: String(adapter.name),
    endpointId: endpoint.$id,
    endpoint,
    kind,
    ...detail,
  };

  const eventName =
    kind === 'connect' ? 'endpoint.connect' : kind === 'disconnect' ? 'endpoint.disconnect' : 'endpoint.error';

  await plugin.root.dispatch(eventName, payload);

  const notice = Notice.from(
    {
      $raw: JSON.stringify(serializeEndpointLifecyclePayload(payload)),
    },
    {
      $id: `endpoint-lifecycle:${endpoint.$id}:${kind}:${Date.now()}`,
      $adapter: adapter.name as never,
      $endpoint: endpoint.$id,
      $type: 'notice',
      $scene_id: endpoint.$id,
      $scene_type: 'endpoint',
      $sub_type: kind,
      $timestamp: Date.now(),
    },
  );

  adapter.emit('notice.receive', notice);
}
