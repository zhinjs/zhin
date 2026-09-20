import { registerDataLifecycleRoutes } from './data-lifecycle-routes.js';
import { registerEffectSponsorRoutes } from './effect-sponsor-routes.js';
import { registerPortfolioSponsorRoutes } from './portfolio-sponsor-routes.js';
import type { WorkroomRouteOptions } from './workroom-request-policy.js';

export function registerWorkroomGovernanceRoutes(
  options: WorkroomRouteOptions,
): void {
  registerPortfolioSponsorRoutes(options);
  registerDataLifecycleRoutes(options);
  registerEffectSponsorRoutes(options);
}
