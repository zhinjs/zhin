/**
 * NDJSON stream consumer utilities — ADR 0039 P0 (Console / SDK).
 */
import {
  createAgentStreamReduceState,
  reduceAgentStreamEvent,
  type AgentStreamEvent,
  type AgentStreamReduceState,
} from "./agent-stream.js";

export type AgentStreamNdjsonParserState = {
  remainder: string;
};

export function createAgentStreamNdjsonParserState(): AgentStreamNdjsonParserState {
  return { remainder: "" };
}

/** Parse complete NDJSON lines from a text chunk; keeps trailing partial line in state. */
export function parseAgentStreamNdjsonChunk(
  chunk: string,
  state: AgentStreamNdjsonParserState = createAgentStreamNdjsonParserState(),
): { events: AgentStreamEvent[]; state: AgentStreamNdjsonParserState } {
  const combined = state.remainder + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";
  const events: AgentStreamEvent[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed) as AgentStreamEvent);
  }
  return { events, state: { remainder } };
}

/** Flush a final partial line after the stream ends. */
export function flushAgentStreamNdjsonParser(
  state: AgentStreamNdjsonParserState,
): { events: AgentStreamEvent[]; state: AgentStreamNdjsonParserState } {
  const trimmed = state.remainder.trim();
  if (!trimmed) {
    return { events: [], state: { remainder: "" } };
  }
  return {
    events: [JSON.parse(trimmed) as AgentStreamEvent],
    state: { remainder: "" },
  };
}

type NdjsonBody =
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array | Buffer | string>;

async function* chunksFromBody(body: NdjsonBody): AsyncGenerator<string> {
  if (Symbol.asyncIterator in body) {
    const decoder = new TextDecoder();
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
      if (typeof chunk === "string") yield chunk;
      else if (Buffer.isBuffer(chunk)) yield decoder.decode(chunk);
      else yield decoder.decode(chunk);
    }
    return;
  }
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Iterate Eve-aligned events from an NDJSON response body. */
export async function* iterateAgentStreamNdjson(
  body: NdjsonBody,
): AsyncGenerator<AgentStreamEvent, void, undefined> {
  const parserState = createAgentStreamNdjsonParserState();
  for await (const chunk of chunksFromBody(body)) {
    const { events, state } = parseAgentStreamNdjsonChunk(chunk, parserState);
    Object.assign(parserState, state);
    for (const event of events) {
      yield event;
    }
  }
  const { events } = flushAgentStreamNdjsonParser(parserState);
  for (const event of events) {
    yield event;
  }
}

export type FoldAgentStreamOptions = {
  onEvent?: (event: AgentStreamEvent, state: AgentStreamReduceState) => void;
};

/** Reduce an NDJSON body to {@link AgentStreamReduceState}. */
export async function foldAgentStreamNdjson(
  body: NdjsonBody,
  options?: FoldAgentStreamOptions,
): Promise<AgentStreamReduceState> {
  let state = createAgentStreamReduceState();
  for await (const event of iterateAgentStreamNdjson(body)) {
    state = reduceAgentStreamEvent(state, event);
    options?.onEvent?.(event, state);
  }
  return state;
}
