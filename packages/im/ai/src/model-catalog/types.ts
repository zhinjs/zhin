import type { ProviderCapabilities } from '../types.js';
import type { SdkId } from '../llm/sdk-registry.js';

export type ModelCapabilities = Readonly<ProviderCapabilities>;

/** Secret references are opaque; only an execution factory may resolve them. */
export interface ModelConnection {
  readonly id: string;
  readonly ownerId: string;
  readonly revision: number;
  readonly sdk: SdkId;
  readonly baseUrl?: string;
  readonly secretRef?: string;
}

export interface CatalogModel {
  readonly id: string;
  readonly connectionId: string;
  readonly model: string;
  readonly capabilities: ModelCapabilities;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
}

export interface ModelPreset {
  readonly id: string;
  readonly modelId: string;
}

export interface ModelCatalogConfig {
  readonly connections: Readonly<Record<string, ModelConnection>>;
  readonly models: Readonly<Record<string, CatalogModel>>;
  readonly presets: Readonly<Record<string, ModelPreset>>;
}

export interface InvocationOwner {
  readonly ownerId: string;
  readonly hostOwnerId: string;
}

/** Only explicitly requested features are checked; unknown is never supported. */
export interface InvocationRequirements {
  readonly input?: ProviderCapabilities['input'];
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly thinking?: boolean;
}

export interface ResolvedInvocation {
  readonly preset: ModelPreset;
  readonly model: CatalogModel;
  readonly connection: ModelConnection;
}

export type ModelCatalogErrorCode = 'invalid-config' | 'unknown-preset' | 'connection-forbidden' | 'unsupported-capability';

export class ModelCatalogError extends Error {
  constructor(readonly code: ModelCatalogErrorCode) {
    super(`Model catalog: ${code}`);
    this.name = 'ModelCatalogError';
  }
}
