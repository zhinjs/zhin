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
  readonly values: Readonly<Record<string, string>>;
}

export interface AdapterConsoleStatus {
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
