import type { EndpointControl, EndpointManagement } from '@zhin.js/adapter';
import type { ConversationRef, DeliveryReceipt } from '@zhin.js/im-contract';
import type { Locale, PluginId } from '@zhin.js/plugin-runtime';
import type { SendContent } from './contracts.js';

/** Capture while the source Message/event is active, before handing work to an asynchronous owner. */
export interface CaptureEndpointOperationInput {
  /** Canonical complete source address; never an account alias. */
  readonly target: ConversationRef;
  /** Actual source Client, checked against the selected account incarnation. */
  readonly client: unknown;
  /** Lifetime of the work that is retaining the source operation. */
  readonly signal?: AbortSignal;
  /** Author supplied by trusted composition or the owner-bound Host facade. */
  readonly requester?: PluginId;
}

/** Retained execution authority for one concrete Client; consumers must release it in finally. */
export interface CapturedEndpointOperation {
  readonly target: ConversationRef;
  readonly signal: AbortSignal;
  /** The same guarded semantic ports as ordinary calls, pinned to the retained Client. */
  readonly control?: EndpointControl;
  readonly management?: EndpointManagement;
  /** Uses the ordinary renderer/middleware/delivery pipeline with the captured author. */
  send(content: SendContent, options?: Readonly<{ locale?: Locale; signal?: AbortSignal }>): Promise<DeliveryReceipt>;
  /** Stops new calls and releases source/Root leases after accepted calls drain; never stops the account. */
  release(): void;
}
