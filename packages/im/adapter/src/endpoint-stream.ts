import type { ConversationRef, Segment } from '@zhin.js/im-contract';
import type { Locale } from '@zhin.js/plugin-runtime';

/** Trusted ingress facts retained with this exact account operation, never model-authored. */
export interface EndpointStreamSource {
  readonly messageId?: string;
  readonly senderId?: string;
  readonly event?: unknown;
}

/** One physical text/Markdown container; Core owns media and format-change barriers. */
export interface EndpointStreamRequest {
  readonly conversation: ConversationRef;
  readonly format: 'text' | 'markdown';
  readonly prefix?: readonly Segment[];
  /** Source already consumed by earlier physical containers of this same logical segment. */
  readonly continuation?: Readonly<{ precedingText: string; replyTo?: string }>;
  readonly source?: EndpointStreamSource;
  readonly locale?: Locale;
  readonly signal?: AbortSignal;
}

export interface EndpointStreamAcknowledgement {
  /** A buffered update has made no new externally visible change. */
  readonly status: 'buffered' | 'preview' | 'sent';
  readonly messageId?: string;
  /** Exact source prefix confirmed by this operation, not the length of a rendered wire body. */
  readonly acceptedText: string;
  /** This physical container has reached a verified platform limit; Core must finish it. */
  readonly exhausted?: true;
  /** Verified canonical content of this physical message, including any visible prefix. */
  readonly confirmedContent?: readonly Segment[];
  /** Accepted source is known, but its independent rich-message rendering cannot be reconstructed. */
  readonly contentUnavailable?: true;
}

/** Platform calls are serial, cumulative-source updates; adapters translate to native deltas. */
export interface EndpointMessageStream {
  /** Latest locally cached acknowledgement; reading it never performs a platform operation. */
  readonly lastAcknowledgement?: EndpointStreamAcknowledgement;
  write(text: string): Promise<EndpointStreamAcknowledgement>;
  finish(text: string): Promise<EndpointStreamAcknowledgement>;
  /** Local cancellation only: no hidden final send, recall or retry. */
  cancel(): void;
}

/** Explicit configured delivery capability. Absent means ordinary complete-message delivery. */
export interface EndpointStreaming {
  readonly mode: 'native' | 'draft' | 'card' | 'edit';
  /** Configured/platform-required flush interval, applied by Core's single sending pump. */
  readonly minIntervalMs?: number;
  /** Pure local preflight before a model is offered progressive delivery; never performs a lookup. */
  supports?(request: Pick<EndpointStreamRequest, 'conversation' | 'source'>): boolean;
  /** Local eligibility only. Undefined is unsupported; an actual lookup failure must throw. */
  open(request: EndpointStreamRequest): EndpointMessageStream | undefined;
}
