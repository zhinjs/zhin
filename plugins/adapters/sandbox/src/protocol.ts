/** Sandbox WebSocket wire protocol helpers (no legacy Adapter/Endpoint). */

export type MessageType = 'private' | 'group' | 'guild' | 'direct' | 'channel';

export interface MessageElement {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

export interface SandboxWsSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on?(event: 'message' | 'close' | 'error', listener: (...args: unknown[]) => void): void;
  off?(
    event: 'message' | 'close' | 'error',
    listener: (...args: unknown[]) => void,
  ): void;
  addEventListener?(
    type: 'message' | 'close' | 'error',
    listener: (ev: Event | MessageEvent | CloseEvent) => void,
  ): void;
  removeEventListener?(
    type: 'message' | 'close' | 'error',
    listener: (ev: Event | MessageEvent | CloseEvent) => void,
  ): void;
}

export type ResolvedSandboxBot = {
  readonly context: 'sandbox';
  readonly name: string;
  readonly owner: string;
  readonly randomNamePerConnection: boolean;
};

export interface SandboxAdapterConfig {
  readonly endpoints?: ReadonlyArray<{
    readonly context?: string;
    readonly name?: string;
    readonly owner?: string;
  }>;
}

export function resolveSandboxEndpoint(
  appConfig: SandboxAdapterConfig,
): ResolvedSandboxBot {
  const entry = appConfig.endpoints?.find((item) => item.context === 'sandbox');
  const fixedName = typeof entry?.name === 'string' ? entry.name : undefined;
  const name = fixedName || process.env.SANDBOX_BOT_NAME || 'sandbox-bot';
  const owner = (typeof entry?.owner === 'string' && entry.owner)
    || process.env.SANDBOX_BOT_OWNER
    || 'sandbox-user';
  return {
    context: 'sandbox',
    name,
    owner,
    randomNamePerConnection: !fixedName,
  };
}

export function bindSandboxWsSocket(
  ws: SandboxWsSocket,
  handlers: {
    onMessage: (raw: string) => void;
    onClose: () => void;
    onError?: (err: unknown) => void;
  },
): () => void {
  if (typeof ws.on === 'function') {
    const onMessage = (...args: unknown[]) => {
      const data = args[0];
      const raw = typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
          ? new TextDecoder().decode(data)
          : Buffer.isBuffer(data)
            ? data.toString()
            : String(data ?? '');
      handlers.onMessage(raw);
    };
    ws.on('message', onMessage);
    ws.on('close', handlers.onClose);
    if (handlers.onError) ws.on('error', handlers.onError);
    return () => {
      ws.off?.('message', onMessage);
      ws.off?.('close', handlers.onClose);
      if (handlers.onError) ws.off?.('error', handlers.onError);
    };
  }
  const onMessage = (ev: Event) => {
    const data = (ev as MessageEvent).data;
    handlers.onMessage(typeof data === 'string' ? data : '');
  };
  const onClose = () => handlers.onClose();
  const onError = handlers.onError
    ? () => handlers.onError?.(new Error('WebSocket error'))
    : undefined;
  ws.addEventListener!('message', onMessage);
  ws.addEventListener!('close', onClose);
  if (onError) ws.addEventListener!('error', onError);
  return () => {
    ws.removeEventListener!('message', onMessage);
    ws.removeEventListener!('close', onClose);
    if (onError) ws.removeEventListener!('error', onError);
  };
}

export function parseSandboxWsPayload(raw: string): {
  type: MessageType;
  id: string;
  content: MessageElement[];
  timestamp: number;
  text: string;
  action?: { id: string; payload: string };
} {
  let payload: {
    type?: MessageType;
    id?: string;
    content?: MessageElement[] | string;
    text?: string;
    timestamp?: number;
  };
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    payload = { text: raw };
  }
  const type = payload.type ?? 'private';
  const id = payload.id ?? 'sandbox-user';
  const content: MessageElement[] = typeof payload.content === 'string'
    ? [{ type: 'text', data: { text: payload.content } }]
    : Array.isArray(payload.content)
      ? payload.content
      : [{ type: 'text', data: { text: payload.text ?? raw } }];

  const actionSegment = content.find((segment) => segment.type === 'action');
  let action: { id: string; payload: string } | undefined;
  if (actionSegment?.data) {
    const actionPayload = typeof actionSegment.data.payload === 'string'
      ? actionSegment.data.payload
      : typeof actionSegment.data.id === 'string'
        ? actionSegment.data.id
        : '';
    const actionId = typeof actionSegment.data.id === 'string'
      ? actionSegment.data.id
      : actionPayload;
    if (actionId || actionPayload) {
      action = { id: actionId || actionPayload, payload: actionPayload || actionId };
    }
  }

  let text = content
    .flatMap((segment) => (segment.type === 'text' && typeof segment.data?.text === 'string'
      ? [segment.data.text]
      : []))
    .join('\n');
  if (!text.trim()) {
    text = (typeof payload.text === 'string' && payload.text.trim())
      ? payload.text
      : action?.payload ?? raw;
  }
  return { type, id, content, timestamp: payload.timestamp ?? Date.now(), text, action };
}

export type SandboxOutboundChannel = {
  readonly type?: string;
  readonly id?: string;
  readonly bot?: string;
  readonly endpoint?: string;
  readonly messageId?: string;
};

/**
 * Wire-encode an already-rendered outbound payload.
 * Stamps `channel` so Console SandboxChat can filter by type+id (otherwise
 * replies look like they disappeared).
 */
export function formatSandboxOutbound(
  payload: unknown,
  channel: SandboxOutboundChannel = {},
): string {
  const stamp: Record<string, unknown> = {};
  if (channel.type) stamp.type = channel.type;
  if (channel.id) stamp.id = channel.id;
  if (channel.bot) stamp.bot = channel.bot;
  if (channel.endpoint) stamp.endpoint = channel.endpoint;
  if (channel.messageId) stamp.messageId = channel.messageId;

  if (typeof payload === 'string') {
    return JSON.stringify({
      ...stamp,
      content: [{ type: 'text', data: { text: payload } }],
      timestamp: Date.now(),
    });
  }
  if (Array.isArray(payload)) {
    return JSON.stringify({
      ...stamp,
      content: payload,
      timestamp: Date.now(),
    });
  }
  // Already a wire envelope ({ content, type, … }) — pass through so the
  // Console UI can read `content` / `type` without an extra nesting layer.
  // Bare segment objects ({ type: 'text', data: … }) still need wrapping.
  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (
      'content' in (payload as object)
      || 'type' in (payload as object) && 'timestamp' in (payload as object)
    )
  ) {
    const envelope = payload as Record<string, unknown>;
    return JSON.stringify({
      ...stamp,
      ...envelope,
      type: envelope.type ?? stamp.type,
      id: envelope.id ?? stamp.id,
      timestamp: typeof envelope.timestamp === 'number' ? envelope.timestamp : Date.now(),
    });
  }
  return JSON.stringify({ ...stamp, content: payload, timestamp: Date.now() });
}

/** WebSocket.OPEN 常量值；Node <22 无全局 WebSocket，不能用 WebSocket.OPEN。 */
const WS_OPEN = 1;

export function whenWsOpen(ws: SandboxWsSocket, fn: () => void): void {
  const std = ws as WebSocket;
  if (typeof std.readyState === 'number') {
    if (std.readyState === WS_OPEN) {
      fn();
      return;
    }
    std.addEventListener('open', fn, { once: true });
    return;
  }
  fn();
}
