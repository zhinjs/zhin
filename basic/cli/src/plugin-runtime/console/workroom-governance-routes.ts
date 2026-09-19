import type { HttpHost } from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { registerDataLifecycleRoutes } from './data-lifecycle-routes.js';
import { registerEffectSponsorRoutes } from './effect-sponsor-routes.js';
import { registerPortfolioSponsorRoutes } from './portfolio-sponsor-routes.js';

export interface RegisterWorkroomGovernanceRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export function registerWorkroomGovernanceRoutes(
  options: RegisterWorkroomGovernanceRoutesOptions,
): void {
  registerPortfolioSponsorRoutes(options);
  registerDataLifecycleRoutes(options);
  registerEffectSponsorRoutes(options);
}
