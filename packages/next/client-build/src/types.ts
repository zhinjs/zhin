import type { ClientModuleArtifact } from '@zhin.js/next-console-contract';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';

export interface ClientBuildEntry extends ClientModuleRequest {
  readonly source: string;
}

export interface ClientArtifactRecord extends ClientBuildEntry, ClientModuleArtifact {}

export interface ClientArtifactManifest {
  readonly protocol: 1;
  readonly entries: readonly ClientArtifactRecord[];
}

export interface ClientModuleLoader {
  load<T = unknown>(source: string, request: ClientModuleRequest): Promise<T>;
}

export interface TypeScriptClientBuilderOptions {
  readonly outDir: string;
  readonly projectRoot?: string;
  readonly publicBase?: string;
  readonly manifestFile?: string;
}
