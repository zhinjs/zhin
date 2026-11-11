import type { RuntimeMessageEvent } from '@zhin.js/core/runtime';
import {
  createResponseStream,
  jsonResponse,
  SSE_HEADERS,
  type ConsoleEventHub,
  type HttpHost,
} from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { sseFrame } from '@zhin.js/gateway/http';
import { listPages, requestConsoleAccess } from './entry-projection.js';

export function publishMessageEvent(hub: ConsoleEventHub, event: RuntimeMessageEvent): void {
  const localName = String(event.conversation.endpoint.id).split('\0').pop()
    ?? String(event.conversation.endpoint.id);
  if (event.direction === 'inbound') {
    hub.publish('message.receive', {
      direction: 'inbound' as const,
      adapter: event.conversation.endpoint.adapter,
      endpointKey: localName,
      conversation: event.conversation,
      sender: event.sender,
      channelType: event.conversation.kind,
      channelId: event.conversation.id,
      content: event.contentPreview,
      messageId: event.messageId,
      timestamp: event.timestamp,
    });
    return;
  }
  hub.publish('message.receive', {
    direction: 'outbound' as const,
    adapter: event.conversation.endpoint.adapter,
    endpointKey: localName,
    conversation: event.conversation,
    requester: event.requester,
    channelType: event.conversation.kind,
    channelId: event.conversation.id,
    content: event.contentPreview,
    timestamp: event.timestamp,
    messageId: event.messageId,
    ...(event.rendering ? { rendering: event.rendering } : {}),
  });
}

export interface RegisterConsoleEventRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly consoleRuntime: ConsoleRuntime;
  readonly hub: ConsoleEventHub;
}

export function registerConsoleEventRoutes(options: RegisterConsoleEventRoutesOptions): void {
  const { http, base, consoleRuntime, hub } = options;

  http.route('GET', `${base}/events/history`, (_request, { url }) => {
    const page = hub.history({
      runtimeId: url.searchParams.get('runtimeId') ?? undefined,
      after: Number(url.searchParams.get('after') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 200),
    });
    return jsonResponse(200, { success: true, data: page });
  }, {
    summary: 'Console event history',
    tags: ['console'],
    description: 'Bounded resumable history for the current Console event runtime.',
  });

  http.route('GET', `${base}/events`, async (request, context) => {
    const { url } = context;
    // The process control plane is available before the first generation.
    // Page discovery becomes ready after commit, while login events must flow
    // during Adapter activation.
    const pages = await listPages(consoleRuntime, requestConsoleAccess(http, request, context)).catch(() => Object.freeze([]));
    const after = Number(
      url.searchParams.get('after')
      ?? url.searchParams.get('lastEventId')
      ?? request.headers.get('last-event-id')
      ?? 0,
    );
    const eventRuntimeId = url.searchParams.get('runtimeId') ?? undefined;
    const stream = createResponseStream();
    // Snapshot frames have no event id. The resumable cursor belongs only to hub journal events.
    stream.write(sseFrame('sync', { key: 'pages', value: pages }));
    stream.write(sseFrame('init-data', { timestamp: Date.now() }));
    const unsubscribe = hub.subscribe(stream, {
      runtimeId: eventRuntimeId,
      after: Number.isSafeInteger(after) && after >= 0 ? after : 0,
    });
    const timer = setInterval(() => {
      stream.write(': keepalive\n\n');
    }, 15_000);
    timer.unref?.();
    stream.onClose(() => {
      clearInterval(timer);
      unsubscribe();
    });
    return new Response(stream.stream, {
      status: 200,
      headers: { ...SSE_HEADERS, 'x-zhin-event-runtime-id': hub.runtimeId },
    });
  }, {
    summary: 'Console SSE stream',
    tags: ['console'],
  });
}
