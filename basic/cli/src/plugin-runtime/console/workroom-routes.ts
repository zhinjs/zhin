import { registerWorkroomGovernanceRoutes } from './workroom-governance-routes.js';
import { registerWorkroomRunRoutes } from './workroom-run-routes.js';
import type { WorkroomRouteOptions } from './workroom-request-policy.js';

export function registerWorkroomConsoleRoutes(
  options: WorkroomRouteOptions,
): void {
  registerWorkroomRunRoutes(options);
  registerWorkroomGovernanceRoutes(options);
}
