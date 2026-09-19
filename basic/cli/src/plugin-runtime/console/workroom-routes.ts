import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { registerWorkroomGovernanceRoutes } from './workroom-governance-routes.js';
import { registerWorkroomRunRoutes } from './workroom-run-routes.js';

export interface RegisterWorkroomConsoleRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export function registerWorkroomConsoleRoutes(
  options: RegisterWorkroomConsoleRoutesOptions,
): void {
  registerWorkroomRunRoutes(options);
  registerWorkroomGovernanceRoutes(options);
}
