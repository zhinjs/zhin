export interface QuotedMessagePayload {
  messageId: string;
  sender?: { id: string; name: string };
  content: Array<{ type: string; data?: Record<string, unknown> }>;
  raw?: string;
  time?: number;
}

export function parseOneBotGetMsgResponse(
  messageId: string,
  data: unknown,
): QuotedMessagePayload {
  const record =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  let content: QuotedMessagePayload['content'] = [];
  if (Array.isArray(record.message)) {
    content = record.message as QuotedMessagePayload['content'];
  } else if (typeof record.raw_message === 'string' && record.raw_message) {
    content = [{ type: 'text', data: { text: record.raw_message } }];
  }

  const senderRaw = record.sender;
  let sender: QuotedMessagePayload['sender'];
  if (senderRaw && typeof senderRaw === 'object') {
    const s = senderRaw as Record<string, unknown>;
    sender = {
      id: String(s.user_id ?? ''),
      name: String(s.nickname ?? s.card ?? ''),
    };
  }

  return {
    messageId,
    sender,
    content,
    raw: typeof record.raw_message === 'string' ? record.raw_message : undefined,
    time: typeof record.time === 'number' ? record.time : undefined,
  };
}
