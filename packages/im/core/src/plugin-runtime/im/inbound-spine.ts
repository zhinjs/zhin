import type { UserInteractionFactory } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { InboundTerminalControl } from '@zhin.js/middleware';
import type {
  GenerationAdmissionGate,
  PluginId,
  SnapshotLease,
} from '@zhin.js/plugin-runtime';
import type { Message, MessageDispatchResult, SendContent } from './contracts.js';
import { resolveIngressRoute, type IngressRoute } from './ingress-route.js';
import type { MessageDispatchOutcome } from './message-dispatcher.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';
import { formatConversationLog } from './message-events.js';

const logger = getLogger('im.inbound');

export type InboundSpineStage =
  | 'pre-route'
  | 'before-dispatch-route'
  | 'handlers'
  | 'interactive'
  | 'command'
  | 'agent-ingress'
  | 'none';

export type InboundCommandObserve = (
  stage: 'prefix' | 'dispatch',
  status: 'mismatch' | 'matched' | 'empty_input' | 'commands_unavailable' | 'started',
) => void;

export interface InboundTurnEnvelope {
  readonly message: Message;
  readonly lease: SnapshotLease;
  readonly requester: PluginId;
  readonly conversationSequence: number | undefined;
  readonly admission?: GenerationAdmissionGate;
  readonly signal?: AbortSignal;
  readonly interactionFactory?: UserInteractionFactory;
  readonly ingressRoute?: IngressRoute;
  readonly diagnostics?: Pick<RuntimeMessageDiagnostics, 'route' | 'step'>;
  runHandlers(): Promise<void>;
  dispatchInteractive(): Promise<MessageDispatchResult | undefined>;
  dispatchCommand(observe: InboundCommandObserve): Promise<MessageDispatchOutcome>;
  hasReplied(): boolean;
  findEventHandlerName?(event: string): string | undefined;
}

export interface InboundSpineOutcome {
  readonly dispatch: MessageDispatchResult;
  readonly stage: InboundSpineStage;
  readonly reply?: { readonly owner: PluginId; readonly content: SendContent };
}

export async function executeInboundTurnSpine(
  envelope: InboundTurnEnvelope,
  control?: InboundTerminalControl,
): Promise<InboundSpineOutcome> {
  const { message, lease, requester, conversationSequence, diagnostics } = envelope;
  const ingressRoute = envelope.ingressRoute ?? resolveIngressRoute(lease.value);

  const preRouted = await ingressRoute?.preRoute?.(
    message,
    lease,
    requester,
    conversationSequence,
  ) === true;
  if (preRouted) {
    diagnostics?.route('agent');
    const dispatch = Object.freeze({ matched: true, command: 'pre-route', owner: requester });
    await control?.reportDispatch({
      matched: true,
      path: 'handler',
      handlerId: 'pre-route',
      replied: envelope.hasReplied(),
    });
    return { dispatch, stage: 'pre-route' };
  }

  if (ingressRoute?.shouldRouteBeforeDispatch?.(message) === true) {
    const handled = await ingressRoute.route(
      message,
      lease,
      requester,
      conversationSequence,
    );
    if (handled) {
      diagnostics?.route('agent');
      const dispatch = Object.freeze({ matched: true, command: 'ai', owner: requester });
      await control?.reportDispatch({
        matched: true,
        path: 'handler',
        handlerId: 'ai',
        replied: envelope.hasReplied(),
      });
      return { dispatch, stage: 'before-dispatch-route' };
    }
  }

  const repliedBeforeHandlers = envelope.hasReplied();
  diagnostics?.step('handlers', 'started');
  await envelope.runHandlers();
  diagnostics?.step('handlers', 'completed');
  const repliedDuringHandlers = !repliedBeforeHandlers && envelope.hasReplied();

  const interactive = await envelope.dispatchInteractive();
  if (interactive) diagnostics?.route('interaction');
  const dispatched = interactive
    ? undefined
    : await envelope.dispatchCommand((stage, status) => diagnostics?.step(stage, status));
  let result: MessageDispatchResult = interactive ?? dispatched!.dispatch;
  let stage: InboundSpineStage = interactive
    ? 'interactive'
    : dispatched?.dispatch.matched
      ? 'command'
      : 'none';

  if (!result.matched && ingressRoute) {
    logger.debug(formatCompact({
      op: 'unmatched',
      conv: formatConversationLog(message.conversation),
    }));
    const handled = await ingressRoute.route(
      message,
      lease,
      requester,
      conversationSequence,
    );
    if (handled) {
      diagnostics?.route('agent');
      result = Object.freeze({ matched: true, command: 'ai', owner: requester });
      stage = 'agent-ingress';
    }
  }

  const response = dispatched?.reply ?? (interactive?.value !== undefined && interactive.owner
    ? { owner: interactive.owner, content: interactive.value as SendContent }
    : undefined);
  const replied = envelope.hasReplied() || response !== undefined;

  if (interactive) {
    await control?.reportDispatch({
      matched: true,
      path: 'button',
      handlerId: interactive.command ?? 'interactive',
      replied,
    });
  } else if (dispatched?.dispatch.matched) {
    await control?.reportDispatch({
      matched: true,
      path: 'command',
      ...(dispatched.dispatch.command ? { handlerId: dispatched.dispatch.command } : {}),
      replied,
    });
  } else if (result.matched) {
    await control?.reportDispatch({
      matched: true,
      path: 'handler',
      ...(result.command ? { handlerId: result.command } : {}),
      replied,
    });
  } else if (repliedDuringHandlers) {
    stage = 'handlers';
    const handlerName = envelope.findEventHandlerName?.('message.receive') ?? 'message.receive';
    await control?.reportDispatch({
      matched: true,
      path: 'handler',
      handlerId: handlerName,
      replied: true,
    });
  } else {
    await control?.reportDispatch({
      matched: false,
      path: 'none',
      replied,
    });
  }

  return {
    dispatch: result,
    stage,
    ...(response ? { reply: response } : {}),
  };
}
