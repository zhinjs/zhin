import type { EndpointEvent } from '@zhin.js/adapter';
import { bindOperationInput, operationInputBinding } from '@zhin.js/feature-kit';
import type { HandlerDispatchOptions } from '@zhin.js/handler';
import type { ConversationRef, DeliveryReceipt, UserInteraction, UserInteractionFactory } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  MiddlewareIndex,
  isMiddlewareIndex,
  middlewareFeatureId,
  type InboundTerminalControl,
} from '@zhin.js/middleware';
import {
  createToken,
  projectLocaleToken,
  resolveLocale,
  userLocalePreferencesToken,
  type GenerationAdmissionGate,
  type Locale,
  type PluginId,
  type RuntimeSnapshot,
  type SnapshotLease,
  type UserLocalePreferences,
} from '@zhin.js/plugin-runtime';
import { HandlerIndex, handlerFeatureId, isHandlerIndex } from '../../feature/handler.js';
import { gatedHandlerIndex, gatedMiddlewareIndex } from './feature-gate.js';
import { RuntimeNotice, type IncomingNotice, type Notice } from '../../notice.js';
import { RuntimeRequest, type IncomingRequest, type Request } from '../../request.js';
import type { EndpointEventContext } from '../../side-event/base.js';
import { RuntimeSystemEvent, type IncomingSystemEvent, type SystemEvent } from '../../system-event.js';
import {
  RuntimeMessage,
  type CapturedEndpointOperation,
  type Message,
  type MessageDispatchResult,
  type SendContent,
  type SendRequest,
} from './contracts.js';
import type {
  RuntimeInteractionCoordinator,
  UserInteractionSource,
} from './interaction-runtime.js';
import type { RuntimeMessageDiagnostics } from './message-diagnostics.js';
import type { MessageDispatchOutcome } from './message-dispatcher.js';
import { formatConversationLog } from './message-events.js';
export {
  arbitrateRoomInboundDeduplication,
  buildRoomInboundRouteInput,
  resolveRoomMembership,
  type InboundRoomRouteRequest,
} from './inbound-dedup.js';

const logger = getLogger('im.inbound');

/** Generation-owned hooks before ordinary dispatch and after it misses. */
export interface IngressRoute {
  preRoute?(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
  shouldRouteBeforeDispatch?(message: Message): boolean;
  route(
    message: Message,
    lease: SnapshotLease,
    requester: PluginId,
    conversationSequence: number | undefined,
  ): Promise<boolean>;
}

export const ingressRouteToken = createToken<IngressRoute>('zhin.im.ingress-route');

export function resolveIngressRoute(snapshot: RuntimeSnapshot): IngressRoute | undefined {
  const candidate = snapshot.resources.get(snapshot.root)?.get(ingressRouteToken.id);
  return candidate
    && typeof candidate === 'object'
    && typeof (candidate as IngressRoute).route === 'function'
    ? candidate as IngressRoute
    : undefined;
}

/**
 * 群管违规上报（ADR 0039 §5，切片 E）。
 *
 * content-moderation 等插件只负责「判定违规」，「判定后做什么」交给 Agent host 的群规执行器：
 * 按该群生效规则的阶梯执行提醒 / 警告 / 禁言（以规则批准作硬闸批准）/ 建议踢人（每次人批出卡）。
 * Agent host 在根作用域提供本 token；未装 Agent（没有本资源）时插件只能提醒 / 警告，不能禁言或踢人。
 */

/** 插件可上报的违规类型（`flood` 由宿主本地检测，不经插件）。 @public */
export type GroupRuleViolationTrigger = 'advertising' | 'abuse';

/** @public */
export interface GroupRuleViolationReport {
  /** Runtime-only authority captured from the actual incoming Client; never persist this object. */
  readonly source: Readonly<{ client: unknown; signal: AbortSignal }>;
  /** 违规消息所在的群会话（`kind` 必须是 `group`）。 */
  readonly conversation: ConversationRef;
  readonly memberId: string;
  readonly memberName?: string;
  /** 入站消息上的平台角色（群主 / 管理员豁免）。 */
  readonly memberRoles?: readonly unknown[];
  readonly trigger: GroupRuleViolationTrigger;
  /** 原消息发出时间（毫秒）。 */
  readonly sentAt: number;
  readonly messageId?: string;
  /** 命中证据（原文摘录）。 */
  readonly evidence?: readonly string[];
  /**
   * 入群不久即发广告：不按阶梯，直接出一张踢人审批卡（每次人批，绝不自动踢）。
   * 只对 `advertising` 生效。
   */
  readonly newcomer?: boolean;
  /** `remind` / `warn` 档的附加动作：撤回原消息（调用方绑定到这条原消息）。 */
  readonly recall?: () => Promise<void>;
}

/**
 * `handled`：执行器已按规则处理（含被控制面 / 豁免 / 冷却跳过），调用方不得再自行提醒或处罚。
 * `no_rule`：该群该类型没有可用规则，调用方可退回只提醒 / 警告。
 * @public
 */
export type GroupRuleViolationOutcome = 'handled' | 'no_rule';

/** 迁移结果：`created` 新建了待确认规则；`exists` 该群该类型已有规则（任意状态）；`unavailable` 规则存储不可用。 @public */
export type GroupRuleDefaultOutcome = 'created' | 'exists' | 'unavailable';

/** @public */
export interface GroupRuleViolationSink {
  report(violation: GroupRuleViolationReport): Promise<GroupRuleViolationOutcome>;
  /**
   * 迁移：该群该类型还没有任何规则时，按默认模板（提醒 → 警告 → 禁言 600 秒，冷静期 30 分钟）
   * 生成一条 `pending` 规则并在群里出预览卡，等群主 / 管理员确认一次。已有任意状态的规则则不动。
   */
  ensureDefaultRule(input: Readonly<{ conversation: ConversationRef; trigger: GroupRuleViolationTrigger }>): Promise<GroupRuleDefaultOutcome>;
}

/** @public */
export const groupRuleViolationToken = createToken<GroupRuleViolationSink>('zhin.im.group-rule-violations');

/**
 * 入群欢迎归属（#1012 A9 方案②）。
 *
 * Agent 会话级欢迎（ADR 0037 切片 A，session-ops `welcome.enabled` + MemberLifecycle）由 Agent host 在根作用域提供本 token。
 * 插件里的旧欢迎（如 group-suite `welcomeMessage`）发送前先问归属：已被会话级欢迎接管的会话，插件不再发送，
 * 欢迎统一走 MemberLifecycle（合并窗口、小时上限、控制面、session-gate），避免同一次入群双发。
 * 未装 Agent（没有本资源）时插件保持原行为。
 */

/** @public */
export interface MemberWelcomeOwner {
  /** 该会话的入群欢迎是否已由会话级欢迎接管（session-ops `welcome.enabled`）。只读内存，不发送、不写审计。 */
  ownsWelcome(conversation: ConversationRef): boolean;
}

/** @public */
export const memberWelcomeOwnerToken = createToken<MemberWelcomeOwner>('zhin.im.member-welcome-owner');

/** Runs the generation-owned middleware projection or the terminal directly. */
export async function runRuntimeMiddleware<TInput>(
  snapshot: RuntimeSnapshot,
  input: TInput,
  terminal: () => Promise<void>,
  target: 'inbound' | 'outbound',
): Promise<void> {
  const index = gatedMiddlewareIndex(input, snapshot);
  if (index) await index.run(input, terminal, target, snapshot);
  else await terminal();
}

function middlewareProjection(snapshot: RuntimeSnapshot): MiddlewareIndex | undefined {
  const projection = snapshot.projections.get(middlewareFeatureId);
  return isMiddlewareIndex(projection) ? projection : undefined;
}

/** Legacy outbound middleware sees one complete reply unless its author explicitly supports revisions. */
export function supportsIncrementalOutbound(snapshot: RuntimeSnapshot, adapter: string): boolean {
  return middlewareProjection(snapshot)?.list().every(record => record.target !== 'outbound'
    || record.adapter !== undefined && record.adapter !== adapter || record.incremental === true) ?? true;
}

export function projectLocale(snapshot: RuntimeSnapshot): Locale {
  return resolveLocale(snapshot.resources.get(snapshot.root)?.get(projectLocaleToken.id)
    ?? (snapshot.config.get(snapshot.root) as { locale?: unknown } | undefined)?.locale);
}

/** Resolve once per operation; callbacks retain the original operation's language. */
export async function messageLocale(snapshot: RuntimeSnapshot, conversation: Pick<ConversationRef, 'endpoint'>,
  senderId?: string): Promise<Locale> {
  const preferences = snapshot.resources.get(snapshot.root)?.get(userLocalePreferencesToken.id) as UserLocalePreferences | undefined;
  return senderId && preferences
    ? await preferences.get(conversation.endpoint, senderId) ?? projectLocale(snapshot)
    : projectLocale(snapshot);
}

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

export interface InboundTurnRecord {
  readonly turnId: string;
  readonly conversation: Message['conversation'];
  readonly senderId?: string;
  readonly stage: InboundSpineStage;
  readonly matched: boolean;
  readonly command?: string;
  readonly owner?: PluginId;
  readonly replied: boolean;
  readonly durationMs: number;
}

export interface InboundTurnEnvelope {
  readonly turnId?: string;
  readonly message: Message;
  readonly lease: SnapshotLease;
  readonly requester: PluginId;
  readonly conversationSequence: number | undefined;
  readonly admission?: GenerationAdmissionGate;
  readonly signal?: AbortSignal;
  readonly interactionFactory?: UserInteractionFactory;
  readonly ingressRoute?: IngressRoute;
  readonly diagnostics?: Pick<RuntimeMessageDiagnostics, 'route' | 'step'>;
  readonly onTurnComplete?: (record: InboundTurnRecord) => void | Promise<void>;
  runHandlers(): Promise<void>;
  dispatchInteractive(): Promise<MessageDispatchResult | undefined>;
  dispatchCommand(observe: InboundCommandObserve): Promise<MessageDispatchOutcome>;
  hasReplied(): boolean;
  findEventHandlerName?(event: string): string | undefined;
}

export interface InboundSpineOutcome {
  readonly dispatch: MessageDispatchResult;
  readonly stage: InboundSpineStage;
  readonly record: InboundTurnRecord;
  readonly reply?: { readonly owner: PluginId; readonly content: SendContent };
}

export async function executeInboundTurnSpine(
  envelope: InboundTurnEnvelope,
  control?: InboundTerminalControl,
): Promise<InboundSpineOutcome> {
  const startedAt = Date.now();
  const { message, lease, requester, conversationSequence, diagnostics } = envelope;
  const turnId = envelope.turnId ?? `${message.id}:${conversationSequence ?? 0}`;
  const finish = async (
    dispatch: MessageDispatchResult,
    stage: InboundSpineStage,
    replied: boolean,
    reply?: { readonly owner: PluginId; readonly content: SendContent },
  ): Promise<InboundSpineOutcome> => {
    const record: InboundTurnRecord = Object.freeze({
      turnId,
      conversation: message.conversation,
      ...(message.sender?.id ? { senderId: message.sender.id } : {}),
      stage,
      matched: dispatch.matched,
      ...(dispatch.command ? { command: dispatch.command } : {}),
      ...(dispatch.owner ? { owner: dispatch.owner } : {}),
      replied,
      durationMs: Math.max(0, Date.now() - startedAt),
    });
    await envelope.onTurnComplete?.(record);
    return {
      dispatch,
      stage,
      record,
      ...(reply ? { reply } : {}),
    };
  };
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
    const replied = envelope.hasReplied();
    await control?.reportDispatch({
      matched: true,
      path: 'handler',
      handlerId: 'pre-route',
      replied,
    });
    return finish(dispatch, 'pre-route', replied);
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
      const replied = envelope.hasReplied();
      await control?.reportDispatch({
        matched: true,
        path: 'handler',
        handlerId: 'ai',
        replied,
      });
      return finish(dispatch, 'before-dispatch-route', replied);
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

  return finish(result, stage, replied, response);
}

export type InboundInteractionPort = Pick<
  RuntimeInteractionCoordinator<GenerationAdmissionGate>,
  'create' | 'createForMessage' | 'createFromUnknown' | 'dispatch' | 'resolveClaim'
> & Partial<Pick<RuntimeInteractionCoordinator<GenerationAdmissionGate>, 'hasPendingAnswer'>>;

export interface InboundOutcome {
  readonly dispatch: MessageDispatchResult;
  readonly reply?: { readonly owner: PluginId; readonly content: SendContent };
}

/** Native arguments and cancellation belong to the same already-admitted Root operation. */
export interface InboundHandlerDispatch {
  readonly lease: SnapshotLease;
  readonly event: string;
  readonly args: readonly unknown[];
  readonly signal?: AbortSignal;
  readonly interactions: InboundInteractionPort;
  readonly deliver: (request: SendRequest, snapshot: RuntimeSnapshot) => Promise<DeliveryReceipt>;
  readonly captureInteraction?: (owner: PluginId, conversation: ConversationRef) => CapturedEndpointOperation;
}

/** A side-event interaction uses its admitted author's exact snapshot and cancellation. */
export interface InboundSideInteractionRequest {
  readonly payload: Notice | Request;
  readonly snapshot: RuntimeSnapshot;
  readonly requester: PluginId;
  readonly signal: AbortSignal;
  readonly interactions: InboundInteractionPort;
  readonly deliver: (request: SendRequest, snapshot: RuntimeSnapshot) => Promise<DeliveryReceipt>;
  readonly retain?: () => CapturedEndpointOperation;
}

export interface InboundInteractiveDispatch {
  readonly message: Message;
  readonly requester: PluginId;
  readonly admission?: GenerationAdmissionGate;
  readonly snapshot: RuntimeSnapshot;
  readonly interactions: InboundInteractionPort;
}

export async function runInboundMiddlewareAndSpine(
  envelope: InboundTurnEnvelope,
  diagnostics?: RuntimeMessageDiagnostics,
): Promise<InboundOutcome> {
  const { message, lease } = envelope;
  const terminal = (control?: InboundTerminalControl): Promise<InboundOutcome> =>
    executeInboundTurnSpine(envelope, control);
  const middleware = gatedMiddlewareIndex(message, lease.value);
  if (isMiddlewareIndex(middleware)) diagnostics?.step('middleware', 'entered');
  const outcome = isMiddlewareIndex(middleware)
    ? await middleware.runInbound(message, terminal, {
        stop: (owner): InboundOutcome => {
          diagnostics?.route('middleware');
          diagnostics?.step('middleware', 'stopped');
          return { dispatch: { matched: true, command: 'middleware', owner } };
        },
        replace: (owner, value, downstream): InboundOutcome => {
          diagnostics?.step('middleware', 'replaced');
          if (!downstream?.dispatch.matched) diagnostics?.route('middleware');
          return {
            dispatch: downstream?.dispatch.matched
              ? downstream.dispatch
              : { matched: true, command: 'middleware', owner },
            reply: { owner, content: value as SendContent },
          };
        },
      }, lease.value)
    : await terminal();
  if (isMiddlewareIndex(middleware)) diagnostics?.step('middleware', 'completed');
  return outcome;
}

export async function dispatchInboundHandlers({
  lease,
  event,
  args,
  signal = lease.stopSignal,
  interactions,
  deliver,
  captureInteraction,
}: InboundHandlerDispatch): Promise<void> {
  const snapshot = lease.value;
  // ADR 0050: only events carrying an endpoint are gated; others keep the full index.
  const index = gatedHandlerIndex(args[0], snapshot);
  if (!index) return;
  const options: HandlerDispatchOptions = {
    snapshot,
    signal,
    resolveInteraction: (name, interactionArgs, owner) => {
      const eventContext = interactionArgs[0] as EndpointEvent | undefined;
      const payload = eventContext?.payload;
      if (name === 'message.receive' && payload instanceof RuntimeMessage) {
        return interactions.createFromUnknown(bindOperationInput(payload, owner, snapshot));
      }
      if (name === 'notice.receive' || name === 'request.receive') {
        return createInteractionForSideEvent({
          payload: payload as Notice | Request,
          snapshot,
          requester: owner,
          signal,
          interactions,
          deliver,
          ...(captureInteraction ? { retain: () => captureInteraction(owner, (payload as Notice | Request).conversation!) } : {}),
        });
      }
      return undefined;
    },
  };
  await index.dispatch(event, args, options);
}

export function createInteractionForSideEvent({
  payload,
  snapshot,
  requester,
  signal,
  interactions,
  deliver,
  retain,
}: InboundSideInteractionRequest): UserInteraction | undefined {
  const conversation = payload.conversation;
  if (!conversation) return undefined;
  const source: UserInteractionSource = Object.freeze({
    conversation,
    ...(payload.actor?.id
      ? { sender: Object.freeze({ id: payload.actor.id }) }
      : {}),
    $reply: (content: SendContent) => deliver({
      conversation,
      requester,
      content,
    }, snapshot),
  });
  return interactions.create(source, undefined, { snapshot, owner: requester, signal, retain });
}

export async function dispatchInboundInteractive({
  message,
  requester,
  admission,
  snapshot,
  interactions,
}: InboundInteractiveDispatch): Promise<MessageDispatchResult | undefined> {
  const handled = await interactions.dispatch(message, admission, snapshot);
  return handled
    ? Object.freeze({ matched: true, command: 'interactive', owner: requester })
    : undefined;
}

export async function dispatchCanonicalEndpointEvent(input: {
  readonly source: EndpointEvent<IncomingNotice | IncomingRequest | IncomingSystemEvent>;
  readonly context: EndpointEventContext;
  readonly assertActive: () => void;
  readonly recordNotice: (notice: Notice) => Promise<unknown>;
  readonly recordRequest?: (request: Request) => Promise<unknown>;
  readonly dispatch: (payload: Notice | Request | SystemEvent) => Promise<void>;
}): Promise<void> {
  const { source, context, assertActive, recordNotice, recordRequest, dispatch } = input;
  if (source.payload.type !== source.name.split('.')[0]) {
    throw new TypeError('Endpoint event payload type does not match its gateway event');
  }
  switch (source.payload.type) {
    case 'notice': {
      const notice = new RuntimeNotice(source.payload, context);
      await recordNotice(notice);
      await dispatch(notice);
      break;
    }
    case 'request':
      await withRequestActionScope(source.payload, async (reqInput) => {
        const request = new RuntimeRequest(reqInput, context);
        const recording = Promise.resolve(recordRequest?.(request)).catch(() => undefined);
        try {
          await dispatch(request);
        } finally {
          await recording;
        }
      }, assertActive);
      break;
    case 'system':
      await dispatch(new RuntimeSystemEvent(source.payload, context));
      break;
  }
}

export function interactionResult(requester: PluginId): MessageDispatchResult {
  return Object.freeze({ matched: true, command: 'interaction', owner: requester });
}

export async function withRequestActionScope(
  request: IncomingRequest,
  dispatch: (request: IncomingRequest) => Promise<void>,
  assertOperation: () => void,
): Promise<void> {
  let active = true;
  const actions = new Set<Promise<void>>();
  const run = (action: () => void | Promise<void>): Promise<void> => {
    if (!active) throw new Error('Request action port expired with its generation operation');
    const operation = Promise.resolve().then(() => { assertOperation(); return action(); });
    actions.add(operation);
    void operation.then(
      () => actions.delete(operation),
      () => actions.delete(operation),
    );
    return operation;
  };
  const scoped: IncomingRequest = Object.freeze({ ...request,
    $approve: async (remark?: string) => run(() => request.$approve(remark)),
    $reject: async (reason?: string) => run(() => request.$reject(reason)),
  });
  try {
    await dispatch(scoped);
  } finally {
    active = false;
    await Promise.allSettled([...actions]);
  }
}

export function handlers(snapshot: RuntimeSnapshot): HandlerIndex | undefined {
  const projection = snapshot.projections.get(handlerFeatureId);
  return isHandlerIndex(projection) ? projection : undefined;
}

export function withEndpointEventPayload<TPayload, TClient, TName extends string>(
  source: EndpointEvent<unknown, TClient, TName>,
  payload: TPayload,
): EndpointEvent<TPayload, TClient, TName> {
  return Object.freeze({
    name: source.name,
    payload,
    endpoint: source.endpoint,
    client: source.client,
    [operationInputBinding]: (owner: PluginId, snapshot: RuntimeSnapshot) =>
      withEndpointEventPayload(source, bindOperationInput(payload, owner, snapshot)),
  });
}
