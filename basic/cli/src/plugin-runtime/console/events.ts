import type { ImRuntime, RuntimeMessageEvent } from '@zhin.js/core/runtime';
import type { ConsoleEventHub, HttpHost } from '@zhin.js/host-http';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import { writeJson, writeSse } from './http-response.js';
import { listPages } from './entry-projection.js';

const messageBridgeInstallations = new WeakSet<ImRuntime>();

export function installMessageEventBridge(
  im: ImRuntime | undefined,
  hub: ConsoleEventHub,
): void {
  if (!im || typeof im.onMessage !== 'function' || messageBridgeInstallations.has(im)) return;
  messageBridgeInstallations.add(im);
  im.onMessage(event => publishMessageEvent(hub, event));
}

export function publishMessageEvent(hub: ConsoleEventHub, event: RuntimeMessageEvent): void {
  const localName = String(event.conversation.endpoint.id).split('\0').pop()
    ?? String(event.conversation.endpoint.id);
  if (event.direction === 'inbound') {
    hub.publish('message.receive', {
      direction: 'inbound' as const,
      adapter: localName,
      endpointKey: localName,
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
    adapter: localName,
    endpointKey: localName,
    requester: event.requester,
    channelType: event.conversation.kind,
    channelId: event.conversation.id,
    content: event.contentPreview,
    timestamp: event.timestamp,
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

  http.route('GET', `${base}/events/history`, (_request, response, url) => {
    const page = hub.history({
      runtimeId: url.searchParams.get('runtimeId') ?? undefined,
      after: Number(url.searchParams.get('after') ?? 0),
      limit: Number(url.searchParams.get('limit') ?? 200),
    });
    writeJson(response, 200, { success: true, data: page });
  }, {
    summary: 'Console event history',
    tags: ['console'],
    description: 'Bounded resumable history for the current Console event runtime.',
  });

  http.route('GET', `${base}/events`, async (request, response, url) => {
    const pages = await listPages(consoleRuntime);
    const headerLastEventId = Array.isArray(request.headers['last-event-id'])
      ? request.headers['last-event-id'][0]
      : request.headers['last-event-id'];
    const after = Number(
      url.searchParams.get('after')
      ?? url.searchParams.get('lastEventId')
      ?? headerLastEventId
      ?? 0,
    );
    const eventRuntimeId = url.searchParams.get('runtimeId') ?? undefined;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-zhin-event-runtime-id': hub.runtimeId,
    });
    // Snapshot frames have no event id. The resumable cursor belongs only to hub journal events.
    writeSse(response, 'sync', { key: 'pages', value: pages });
    writeSse(response, 'init-data', { timestamp: Date.now() });
    const unsubscribe = hub.subscribe(response, {
      runtimeId: eventRuntimeId,
      after: Number.isSafeInteger(after) && after >= 0 ? after : 0,
    });
    const timer = setInterval(() => {
      try {
        response.write(': keepalive\n\n');
      } catch {
        clearInterval(timer);
      }
    }, 15_000);
    request.once('close', () => {
      clearInterval(timer);
      unsubscribe();
      try {
        response.end();
      } catch {
        // The client may already have closed the stream.
      }
    });
  }, {
    summary: 'Console SSE stream',
    tags: ['console'],
  });
}
