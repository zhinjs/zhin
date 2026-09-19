import { registerWorkroomRunControlRoute } from './workroom-run-control-route.js';
import { registerWorkroomRunQueryRoutes } from './workroom-run-query-routes.js';
import type { WorkroomRouteOptions } from './workroom-request-policy.js';

export function registerWorkroomRunRoutes(options: WorkroomRouteOptions): void {
  registerWorkroomRunQueryRoutes(options);
  registerWorkroomRunControlRoute(options);
}
