import type { IncomingNotice } from '../notice.js';
import type { IncomingRequest } from '../request.js';
import type { IncomingSystemEvent } from '../system-event.js';

export function senderFromId(id: unknown, name?: string) {
  if (id == null || id === '') return undefined;
  const s = String(id);
  return { id: s, name: name ?? s };
}

/** Keep native fields under metadata; never mutate or flatten the platform event. */
export function buildNotice<T extends object>(input: T, format: Omit<IncomingNotice, 'metadata'>): IncomingNotice {
  return Object.freeze({ ...format, metadata: Object.freeze({ ...input }) });
}

export function buildRequest<T extends object>(input: T, format: Omit<IncomingRequest, 'metadata'>): IncomingRequest {
  return Object.freeze({ ...format, metadata: Object.freeze({ ...input }) });
}

export function buildSystem<T extends object>(input: T, format: Omit<IncomingSystemEvent, 'metadata'>): IncomingSystemEvent {
  return Object.freeze({ ...format, metadata: Object.freeze({ ...input }) });
}
