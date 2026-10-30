/** Wire shapes for `plugin.<pluginId>.status` and the shared adapter page. */
import type { ConsoleEndpointSummary } from '@zhin.js/console-protocol';

export interface AdapterConsoleFieldView {
  readonly key: string;
  readonly required: boolean;
  readonly env: boolean;
  readonly secret: boolean;
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Record<string, string>>;
  readonly placeholder?: string;
}

export interface AdapterConsoleActionFieldView {
  readonly key: string;
  readonly label: string;
  readonly labelI18n?: Readonly<Record<string, string>>;
  readonly required: boolean;
  readonly placeholder?: string;
  readonly secret: boolean;
}

export interface AdapterConsoleActionOptionView {
  readonly value: string;
  readonly label: string;
  readonly labelI18n?: Readonly<Record<string, string>>;
}

export interface AdapterConsoleActionView {
  readonly name: string;
  readonly label: string;
  readonly labelI18n?: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly descriptionI18n?: Readonly<Record<string, string>>;
  readonly confirm?: string;
  readonly fields: readonly AdapterConsoleActionFieldView[];
  readonly options: readonly AdapterConsoleActionOptionView[];
}

export interface AdapterConsoleConfiguredEndpoint {
  readonly id: string;
  readonly instanceId?: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface AdapterConsoleExecution {
  readonly instanceId: string;
  readonly action: 'add' | 'update' | 'start' | 'stop' | 'remove' | 'replace';
  readonly revision: number | null;
  readonly status: 'pending' | 'applied' | 'failed';
  readonly code?: string;
}

export interface AdapterConsoleRuntimeEndpoint {
  readonly instanceId: string;
  readonly canonicalId: string;
  readonly endpointId: string;
  readonly revision: number | null;
  readonly desiredEnabled: boolean;
  readonly epoch: number;
  readonly incarnationId?: string;
  readonly started: boolean;
  readonly admitted: boolean;
  readonly retiring?: boolean;
  readonly removed?: boolean;
  readonly execution?: AdapterConsoleExecution;
}

export interface AdapterConsoleRuntimeView {
  readonly adapterId: string;
  readonly generation: number;
  readonly revision: number | null;
  readonly needsMigration: boolean;
  readonly canManage: boolean;
  readonly canMigrate: boolean;
  readonly canUpdate: boolean;
  readonly canReplace: boolean;
  readonly mutableFields: readonly string[];
  readonly identityFields: readonly string[];
  readonly endpoints: readonly AdapterConsoleRuntimeEndpoint[];
  readonly lastMutation?: AdapterConsoleExecution;
}

export interface AdapterConsoleMutationResult {
  readonly saved: true;
  readonly restartRequired: false;
  readonly execution: { readonly status: 'pending' | 'applied' | 'failed'; readonly code?: string };
  readonly operation?: AdapterConsoleExecution;
  readonly runtime: AdapterConsoleRuntimeView;
}

export interface AdapterConsoleLoginIdentity {
  readonly incarnationId: string;
  readonly canonicalId: string;
  readonly instanceId: string;
  readonly epoch: number;
}

export interface AdapterConsoleStatus {
  readonly runtime?: AdapterConsoleRuntimeView;
  readonly adapterKey: string;
  readonly displayName: string;
  readonly page: string;
  readonly fields: readonly AdapterConsoleFieldView[];
  readonly canAdd: boolean;
  readonly canRemove: boolean;
  readonly configStore: boolean;
  readonly running: readonly { readonly id: string; readonly mode?: string }[];
  readonly configured: readonly AdapterConsoleConfiguredEndpoint[];
  readonly actions: readonly AdapterConsoleActionView[];
  readonly extra?: Readonly<Record<string, string | number | boolean>>;
  readonly docsUrl?: string;
  readonly readPermission?: string;
  readonly writePermission?: string;
  /** 字符串形式（`RegExp.source`），页面用 `new RegExp` 校验。 */
  readonly idPattern?: string;
  readonly idHint?: string;
  readonly idHintI18n?: Readonly<Record<string, string>>;
}

export interface AdapterConsoleActionResult {
  readonly message?: string;
  readonly tone?: 'ok' | 'error';
  readonly url?: string;
  readonly image?: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

export interface AdapterConsoleLoginTask {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly endpointIdentity?: AdapterConsoleLoginIdentity;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly expiresAt?: number;
}

export interface AdapterConsoleConnectionTest {
  readonly reachable: boolean;
  readonly connected: boolean;
  readonly status?: string;
  readonly transportState?: string;
  readonly phase?: string;
  readonly pendingLogin?: boolean;
  readonly latencyMs?: number;
  readonly message?: string;
}

export type AdapterConsoleEndpoint = ConsoleEndpointSummary;

export interface AdapterConsolePageEntry {
  readonly owner?: string;
  readonly localName?: string;
  readonly source?: string;
  readonly route?: string;
}
