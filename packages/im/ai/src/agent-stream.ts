/**
 * Agent stream wire format — ADR 0039 P0.
 * Eve-aligned event vocabulary for Host NDJSON streams and Console consumers.
 */

/** Response / stream header for the active run handle (distinct from continuationToken). */
export const ZHIN_SESSION_ID_HEADER = "x-zhin-session-id";

export const AGENT_STREAM_MEDIA_TYPE = "application/x-ndjson; charset=utf-8";

/** Version of the additive run envelope used for ordered turn events. */
export const AGENT_RUN_EVENT_VERSION = 1 as const;

export type AgentRunTerminal = "completed" | "failed" | "cancelled" | "budget_exceeded";

export interface AgentRunIdentity {
  readonly sessionId: string;
  readonly turnId: string;
}

/** Stable session API prefix (not Eve `/eve/v1`). */
export const ZHIN_AGENT_SESSION_API_PREFIX = "/zhin/v1";

export const AgentStreamEventType = {
  SESSION_STARTED: "session.started",
  SESSION_WAITING: "session.waiting",
  SESSION_COMPLETED: "session.completed",
  SESSION_FAILED: "session.failed",
  TURN_STARTED: "turn.started",
  TURN_COMPLETED: "turn.completed",
  TURN_FAILED: "turn.failed",
  TURN_CANCELLED: "turn.cancelled",
  TURN_BUDGET_EXCEEDED: "turn.budget_exceeded",
  MESSAGE_RECEIVED: "message.received",
  MESSAGE_APPENDED: "message.appended",
  MESSAGE_COMPLETED: "message.completed",
  ACTIONS_REQUESTED: "actions.requested",
  ACTION_RESULT: "action.result",
  REASONING_APPENDED: "reasoning.appended",
  SUBAGENT_CALLED: "subagent.called",
  SUBAGENT_COMPLETED: "subagent.completed",
  INPUT_REQUESTED: "input.requested",
  INPUT_COMPLETED: "input.completed",
  AUTHORIZATION_REQUIRED: "authorization.required",
  AUTHORIZATION_COMPLETED: "authorization.completed",
  STEP_STARTED: "step.started",
  STEP_COMPLETED: "step.completed",
  STEP_INTERRUPTED: "step.interrupted",
} as const;

export type AgentStreamEventTypeName =
  (typeof AgentStreamEventType)[keyof typeof AgentStreamEventType];

export type AgentStreamEvent = {
  type: AgentStreamEventTypeName | (string & {});
  data?: Record<string, unknown>;
  timestamp?: number;
};

/** Input accepted by an {@link AgentRunJournal}. */
export type AgentRunEventInput = AgentStreamEvent & {
  readonly terminal?: AgentRunTerminal;
};

/**
 * Versioned event emitted from a single turn. It remains structurally
 * compatible with AgentStreamEvent, so existing consumers can ignore the
 * additive envelope.
 */
export type AgentRunEvent = AgentStreamEvent & {
  readonly version: typeof AGENT_RUN_EVENT_VERSION;
  readonly run: AgentRunIdentity;
  readonly sequence: number;
  readonly terminal?: AgentRunTerminal;
};

/**
 * In-memory ordered journal for one agent turn. The journal owns the run
 * identity and sequence, and closes permanently after its first terminal.
 *
 * When a {@link JournalStore} is provided, every appended event is written
 * through to the persistent backend (fire-and-forget — the in-memory list
 * is the source of truth for the current turn; persistence failures are
 * logged but never block the turn).
 */
export class AgentRunJournal {
  readonly run: AgentRunIdentity;
  #events: AgentRunEvent[] = [];
  #terminal: AgentRunEvent | undefined;
  readonly #store: import('./journal-store.js').JournalStore | undefined;

  constructor(run: AgentRunIdentity, store?: import('./journal-store.js').JournalStore) {
    this.run = run;
    this.#store = store;
  }

  append(event: AgentRunEventInput): AgentRunEvent | undefined {
    if (this.#terminal) return undefined;
    const appended: AgentRunEvent = {
      ...event,
      version: AGENT_RUN_EVENT_VERSION,
      run: this.run,
      sequence: this.#events.length + 1,
      timestamp: event.timestamp ?? Date.now(),
    };
    this.#events.push(appended);
    if (appended.terminal) this.#terminal = appended;
    if (this.#store) {
      Promise.resolve(this.#store.append(appended, appended.sequence - 1)).catch(() => {});
    }
    return appended;
  }

  replay(afterSequence = 0): readonly AgentRunEvent[] {
    return this.#events.filter((event) => event.sequence > afterSequence);
  }

  get terminal(): AgentRunEvent | undefined {
    return this.#terminal;
  }
}

export type StartAgentSessionResponse = {
  ok: true;
  sessionId: string;
  continuationToken: string;
};

export type ContinueAgentSessionBody = {
  continuationToken: string;
  message: string;
};

export type ContinueAgentSessionResponse = {
  ok: true;
  sessionId: string;
  continuationToken: string;
};

/** One NDJSON line (includes trailing newline). */
export function formatAgentStreamNdjsonLine(event: AgentStreamEvent): string {
  const line: AgentStreamEvent = {
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  };
  return `${JSON.stringify(line)}\n`;
}

/**
 * Minimal reducer state for Console / SDK clients consuming NDJSON streams.
 */
export type AgentStreamPendingInput = {
  requestId: string;
  kind: string;
  toolName?: string;
  args?: Record<string, unknown>;
  prompt?: string;
};

export type AgentStreamPendingAuthorization = {
  requestId: string;
  connection: string;
  authUrl?: string;
  scope?: string;
};

export type AgentStreamReduceState = {
  assistantText: string;
  lastEventType: string | null;
  waiting: boolean;
  failed: boolean;
  cancelled: boolean;
  pendingInputs: AgentStreamPendingInput[];
  pendingAuthorizations: AgentStreamPendingAuthorization[];
};

export function createAgentStreamReduceState(): AgentStreamReduceState {
  return {
    assistantText: "",
    lastEventType: null,
    waiting: false,
    failed: false,
    cancelled: false,
    pendingInputs: [],
    pendingAuthorizations: [],
  };
}

export function reduceAgentStreamEvent(
  state: AgentStreamReduceState,
  event: AgentStreamEvent,
): AgentStreamReduceState {
  const next = { ...state, lastEventType: event.type };
  switch (event.type) {
    case AgentStreamEventType.MESSAGE_APPENDED: {
      const delta = typeof event.data?.messageDelta === "string" ? event.data.messageDelta : "";
      const cumulative =
        typeof event.data?.message === "string" ? event.data.message : state.assistantText + delta;
      next.assistantText = cumulative;
      next.waiting = false;
      break;
    }
    case AgentStreamEventType.MESSAGE_COMPLETED: {
      if (typeof event.data?.message === "string") {
        next.assistantText = event.data.message;
      }
      next.waiting = false;
      break;
    }
    case AgentStreamEventType.SESSION_STARTED:
    case AgentStreamEventType.TURN_STARTED:
    case AgentStreamEventType.SESSION_COMPLETED:
    case AgentStreamEventType.TURN_COMPLETED:
      // 有新的会话/轮次活动即不再处于 waiting
      next.waiting = false;
      break;
    case AgentStreamEventType.SESSION_WAITING:
      next.waiting = true;
      break;
    case AgentStreamEventType.SESSION_FAILED:
    case AgentStreamEventType.TURN_FAILED:
      next.failed = true;
      next.waiting = false;
      break;
    case AgentStreamEventType.TURN_CANCELLED:
      next.cancelled = true;
      next.waiting = false;
      break;
    case AgentStreamEventType.INPUT_REQUESTED: {
      const requestId = typeof event.data?.requestId === "string" ? event.data.requestId : "";
      const kind = typeof event.data?.kind === "string" ? event.data.kind : "unknown";
      if (requestId) {
        next.pendingInputs = [
          ...state.pendingInputs.filter((p) => p.requestId !== requestId),
          {
            requestId,
            kind,
            toolName: typeof event.data?.toolName === "string" ? event.data.toolName : undefined,
            args:
              event.data?.args && typeof event.data.args === "object" && !Array.isArray(event.data.args)
                ? (event.data.args as Record<string, unknown>)
                : undefined,
            prompt: typeof event.data?.prompt === "string" ? event.data.prompt : undefined,
          },
        ];
      }
      break;
    }
    case AgentStreamEventType.INPUT_COMPLETED: {
      const requestId = typeof event.data?.requestId === "string" ? event.data.requestId : "";
      if (requestId) {
        next.pendingInputs = state.pendingInputs.filter((p) => p.requestId !== requestId);
      }
      break;
    }
    case AgentStreamEventType.AUTHORIZATION_REQUIRED: {
      const requestId = typeof event.data?.requestId === "string" ? event.data.requestId : "";
      const connection = typeof event.data?.connection === "string" ? event.data.connection : "";
      if (requestId && connection) {
        next.pendingAuthorizations = [
          ...state.pendingAuthorizations.filter((p) => p.requestId !== requestId),
          {
            requestId,
            connection,
            authUrl: typeof event.data?.authUrl === "string" ? event.data.authUrl : undefined,
            scope: typeof event.data?.scope === "string" ? event.data.scope : undefined,
          },
        ];
      }
      break;
    }
    case AgentStreamEventType.AUTHORIZATION_COMPLETED: {
      const requestId = typeof event.data?.requestId === "string" ? event.data.requestId : "";
      if (requestId) {
        next.pendingAuthorizations = state.pendingAuthorizations.filter(
          (p) => p.requestId !== requestId,
        );
      }
      break;
    }
    default:
      break;
  }
  return next;
}
