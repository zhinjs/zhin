export interface ConsoleRpcExtendedCtx {
  /** full scope 才允许写操作；demo scope 只放行只读 RPC。 */
  fullScope: boolean;
  projectRoot: string;
  /** Plugin Runtime ScheduleHost（basic/cli schedule-host-installer 提供）。 */
  scheduleHost?: unknown;
  /** 在固定 generation lease 内执行一次 Endpoint 管理操作。 */
  withEndpointManagement?: <T>(
    adapter: string,
    endpointKey: string,
    run: (management: EndpointManagementPort) => T | Promise<T>,
  ) => Promise<T | null>;
  /** Plugin Runtime DatabaseHost 的 models 视图。 */
  databaseHost?: { models: { get(name: string): unknown } };
  /** Narrow generation-bound persistent-job port; null when Assistant is disabled. */
  resolveScheduleEngine?: () => ConsoleScheduleEngine | null | undefined;
  /** LoginAssist list/submit/cancel（刷新后仍可消费扫码/滑块待办）。 */
  loginAssist?: {
    listPending(): readonly {
      id: string;
      adapter: string;
      endpointKey: string;
      type: string;
      payload: Record<string, unknown>;
      createdAt: number;
      expiresAt?: number;
    }[];
    submit(id: string, value: string | Record<string, unknown>): boolean;
    cancel(id: string, reason?: string): boolean;
  };
  /** Authenticated Root adapter; mutation DTOs deliberately contain no principal/decision fields. */
  workroomProfileControl?: ConsoleWorkroomProfileControlPort;
  /** Authenticated HTTP principal; never accepted from the RPC body. */
  authenticatedPrincipal?: Readonly<{ principalId: string }>;
  workroomKnowledgeControl?: ConsoleWorkroomKnowledgeControlPort;
}

export interface ConsoleWorkroomProfileControlPort {
  getPlanningStatus(projectId: string,
    authenticatedPrincipal?: Readonly<{ principalId: string }>): Promise<unknown>;
  bootstrapPlanning(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRegistryRevision: number;
    includeTools?: readonly string[];
    includeSkills?: readonly string[];
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishPack(command: Readonly<{ operationId: string; pack: unknown }>,
    authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishProfile(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRegistryRevision: number;
    overlay: unknown;
    activate: boolean;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishRollback(command: Readonly<{
    operationId: string;
    projectId: string;
    expectedRegistryRevision: number;
    restoredFromRevisionId: string;
    overlay: unknown;
    activate: boolean;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  publishPlanningPolicy(command: Readonly<{
    operationId: string;
    projectId: string;
    profileRevisionId: string;
    revision: number;
    expectedPreviousDigest?: string;
    policy: unknown;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
}

export interface ConsoleWorkroomKnowledgeControlPort {
  read(projectId: string): Promise<unknown>;
  publish(command: Readonly<{
    operationId: string; projectId: string; expectedRevision: number; entries: readonly unknown[];
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
  rollback(command: Readonly<{
    operationId: string; projectId: string; expectedRevision: number; restoreRevision: number;
  }>, authenticatedPrincipal: Readonly<{ principalId: string }>): Promise<unknown>;
}

export interface ConsoleScheduleEngine {
  addJob(job: Record<string, unknown>): Promise<Record<string, unknown>>;
  removeJob(id: string): Promise<boolean>;
  pauseJob(id: string): Promise<boolean>;
  resumeJob(id: string): Promise<boolean>;
  listJobs(): Promise<Record<string, unknown>[]>;
}

export type ExtendedRpcResult = { data: unknown } | { error: string };

const CRON_NOT_WIRED =
  '持久化调度未接线：当前 Plugin Runtime ScheduleHost 仅支持插件注册的内存任务（list），' +
  '不支持 add/remove/pause/resume（需要 @zhin.js/agent 持久化调度引擎）';

const CONSUMED_NOT_WIRED =
  '收件箱已读标记未接线：unified_inbox_request/notice 表未注册或 DatabaseHost 未启动';

export interface ScheduleJobRow {
  id: string;
  cron: string;
  description?: string;
}

export interface InboxSelection {
  where(query: Record<string, unknown>): InboxSelection;
  /** 可选：DB 侧排序下推（wrapModel 链具备该能力，轻量 fake 可缺失）。 */
  orderBy?(field: string, direction?: 'ASC' | 'DESC'): InboxSelection;
  /** 可选：DB 侧 limit 下推。 */
  limit?(count: number): InboxSelection;
  /** 可选：DB 侧 offset 下推。 */
  offset?(count: number): InboxSelection;
  then<TResult1 = Record<string, unknown>[], TResult2 = never>(
    onfulfilled?: ((value: Record<string, unknown>[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

export interface InboxModel {
  select(): InboxSelection;
  update?(patch: Record<string, unknown>): {
    where(query: Record<string, unknown>): Promise<unknown> | unknown;
  };
}

export interface EndpointManagementPort {
  listFriends?(): Promise<readonly { user_id: number | string; nickname: string; remark: string }[]>;
  listGroups?(): Promise<readonly { group_id: number | string; name: string }[]>;
  listChannels?(): Promise<readonly {
    id: string;
    name?: string;
    parent?: { type: string; id: string; name?: string };
  }[]>;
  listGroupMembers?(groupId: string): Promise<readonly unknown[]>;
  listRequests?(): Promise<readonly {
    platform_request_id: string;
    type: string;
    scene_type?: string | null;
    scene_id: string;
    sub_type?: string | null;
    actor_id: string;
    actor_name?: string | null;
    comment?: string | null;
    created_at: number;
  }[]>;
  approveRequest?(requestId: string, remark?: string): Promise<void>;
  rejectRequest?(requestId: string, reason?: string): Promise<void>;
  kickGroupMember?(groupId: string, userId: string): Promise<void>;
  muteGroupMember?(groupId: string, userId: string, durationSeconds: number): Promise<void>;
  setGroupAdmin?(groupId: string, userId: string, enabled: boolean): Promise<void>;
  deleteFriend?(userId: string): Promise<void>;
}
