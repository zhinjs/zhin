import type { ImRuntime } from '@zhin.js/core/runtime';
import { conversationEventQueryFields, conversationRefKey, type ConversationEvent, type ConversationRef, type ForwardEntry, type MessageRef, type Segment } from '@zhin.js/im-contract';
import type { HttpHost } from '@zhin.js/host-http';
import { encodeStorageIdentity, type DatabaseHost } from '@zhin.js/plugin-runtime';
import { parseConversationSessionKey } from './conversation-session.js';
import { writeJson } from './http-response.js';

const PAGE_SIZE = 50;

/** Projects recorded conversation facts; never dispatches, replays, or reads Agent context. */
export function registerConversationHistoryRoutes(options: Readonly<{
  http: HttpHost;
  base: string;
  im?: Pick<ImRuntime, 'endpoints' | 'conversationEventReader' | 'runWithSnapshotView'>;
  databaseHost?: Pick<DatabaseHost, 'started' | 'models'>;
}>): void {
  const { http, base, im, databaseHost } = options;
  http.route('GET', `${base}/conversations/history`, async (_request, response, url, authScope) => {
    response.setHeader('cache-control', 'no-store');
    if (authScope !== 'full') {
      writeJson(response, 403, { success: false, error: '当前凭据不能读取聊天记录' });
      return;
    }
    const sessionKey = url.searchParams.get('sessionKey');
    const session = sessionKey ? parseConversationSessionKey(sessionKey) : undefined;
    const before = url.searchParams.get('beforeSequence');
    const beforeSequence = before === null ? undefined : Number(before);
    if (!session || !['private', 'group', 'channel'].includes(session.kind)
      || (before !== null && (!/^\d+$/u.test(before) || !Number.isSafeInteger(beforeSequence) || beforeSequence! <= 0))) {
      writeJson(response, 400, { success: false, code: 'invalid_history_query', error: '请提供有效的会话和历史游标' });
      return;
    }
    const model = databaseHost?.started ? databaseHost.models.get('conversation_events') : undefined;
    if (!im || !model) {
      writeJson(response, 503, { success: false, code: 'history_unavailable', error: '聊天记录读取尚未就绪' });
      return;
    }
    try {
      const result = await im.runWithSnapshotView(async () => {
        const endpoint = im.endpoints.get(session.adapter, session.endpointKey)?.endpoint;
        if (!endpoint) return { status: 503, code: 'history_unavailable', error: '当前账号地址无法准确解析，暂时不能读取聊天记录' } as const;
        // Use the same encoded query fields as the canonical writer; opaque Endpoint IDs may contain NUL.
        const scope = { endpoint_adapter: encodeStorageIdentity(endpoint.adapter), endpoint_id: encodeStorageIdentity(endpoint.id),
          conversation_kind: session.kind, conversation_id: encodeStorageIdentity(session.id), query_version: 1 };
        const [row] = await model.select('id', 'event_json').where(scope).orderBy('id', 'DESC').limit(1);
        if (!row) return { status: 404, code: 'history_not_recorded', error: '该会话没有保存的聊天记录' } as const;
        const event = JSON.parse(String(row.event_json)) as ConversationEvent;
        const conversation = event.conversation;
        const actual = conversationEventQueryFields(event);
        if (Object.entries(scope).some(([key, value]) => actual[key] !== value)) throw new Error('Conversation history identity mismatch');
        // A coarse session key cannot choose between parent containers or threads. Compare indexed
        // address columns instead of scanning payloads or mistaking encoded/legacy keys for different scenes.
        const alternatives = ['parent_kind', 'parent_id', 'thread_id'].flatMap<Record<string, unknown>>(key => actual[key] === null
          ? [{ [key]: { $ne: null } }]
          : [{ [key]: { $ne: actual[key] } }, { [key]: null }]);
        const ambiguous = await model.select('id').where({ ...scope, $or: alternatives }).limit(1);
        if (ambiguous.length) return { status: 409, code: 'conversation_ambiguous', error: '该会话包含多个频道或话题，无法准确选择聊天记录' } as const;
        const reader = im.conversationEventReader;
        // The extra event establishes hasMore independently of the visible message types.
        const latestSequence = Number(row.id);
        const throughSequence = beforeSequence === undefined ? latestSequence : Math.min(beforeSequence - 1, latestSequence);
        const page = await reader.listBetween(conversation, 0, throughSequence, PAGE_SIZE + 1);
        if (page.some(item => conversationRefKey(item.event.conversation) !== conversationRefKey(conversation))) throw new Error('Conversation history reader returned another scene');
        const hasMore = page.length > PAGE_SIZE;
        const entries = page.slice(-PAGE_SIZE);
        return { status: 200, data: {
          conversation: projectConversation(conversation),
          items: entries.map(({ sequence, event: item }) => ({ sequence, type: item.type, timestamp: item.timestamp,
            ...(item.type === 'message.created' ? { message: {
              ref: projectMessageRef(item.message.ref),
              ...(item.message.actor ? { actor: { id: item.message.actor.id, ...(item.message.actor.displayName === undefined ? {} : { displayName: item.message.actor.displayName }) } } : {}),
              segments: item.message.segments.map(projectSegment), timestamp: item.message.timestamp,
              ...(item.message.replyTo ? { replyTo: projectMessageRef(item.message.replyTo) } : {}),
            } } : {}),
            ...(item.type === 'message.recalled' ? { messageRef: projectMessageRef(item.message) } : {}),
          })),
          nextBeforeSequence: hasMore ? entries[0]!.sequence : null,
          hasMore,
        } } as const;
      });
      if (result.status === 200) writeJson(response, 200, { success: true, data: result.data });
      else writeJson(response, result.status, { success: false, code: result.code, error: result.error });
    } catch {
      writeJson(response, 503, { success: false, code: 'history_unavailable', error: '暂时无法读取聊天记录，请稍后重试' });
    }
  }, { summary: 'Read recorded conversation history', tags: ['conversations'], description: 'Full-scope, read-only canonical history. Fifty events per page; ambiguous parent/thread addresses are unavailable.' });
}

function projectConversation(conversation: ConversationRef): ConversationRef {
  return { endpoint: { id: conversation.endpoint.id, adapter: conversation.endpoint.adapter }, kind: conversation.kind, id: conversation.id,
    ...(conversation.parent ? { parent: { kind: conversation.parent.kind, id: conversation.parent.id } } : {}),
    ...(conversation.threadId === undefined ? {} : { threadId: conversation.threadId }),
  };
}

function projectMessageRef(ref: MessageRef): MessageRef {
  return { conversation: projectConversation(ref.conversation), id: ref.id };
}

/** Never expose local media, base64, platform payloads, or arbitrary segment properties. */
function projectSegment(segment: Segment): Segment {
  const data: Readonly<Record<string, unknown>> = segment.data;
  const strings = (...keys: string[]) => Object.fromEntries(keys.flatMap(key => typeof data[key] === 'string' ? [[key, data[key]]] : []));
  switch (segment.type) {
    case 'text': return { type: 'text', data: strings('text') };
    case 'markdown': return { type: 'markdown', data: strings('content', 'text') };
    case 'tts': return { type: 'tts', data: strings('text') };
    case 'mention': return { type: 'mention', data: strings('target', 'name') };
    case 'reply': return { type: 'reply', data: strings('message_id') };
    case 'face': return { type: 'face', data: { ...strings('name', 'text'), ...(['string', 'number'].includes(typeof data.id) ? { id: data.id } : {}) } };
    case 'dice': case 'rps': return { type: segment.type, data: typeof data.result === 'number' ? { result: data.result } : {} };
    case 'forward': return { type: 'forward', data: { ...strings('forward_id', 'title'),
      ...(Array.isArray(data.entries) ? { entries: (data.entries as readonly ForwardEntry[]).map(entry => ({
        ...(entry.actor ? { actor: { id: entry.actor.id, ...(entry.actor.displayName === undefined ? {} : { displayName: entry.actor.displayName }) } } : {}),
        ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }), segments: entry.segments.map(projectSegment),
      })) } : {}),
    } };
    case 'share': return { type: 'share', data: { ...strings('title', 'description'), ...(publicUrl(data.url) ? { url: data.url } : {}) } };
    case 'image': case 'audio': case 'video': case 'file': {
      const media = data.media as { kind?: unknown; value?: unknown } | undefined;
      return { type: segment.type, data: {
        ...strings('alt', 'name'),
        ...(typeof data.duration === 'number' ? { duration: data.duration } : {}),
        ...(media?.kind === 'url' && publicUrl(media.value) ? { media: { kind: 'url', value: media.value } } : {}),
      } };
    }
    default: return { type: segment.type, data: {} };
  }
}

function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}
