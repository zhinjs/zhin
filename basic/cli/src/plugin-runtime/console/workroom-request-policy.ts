import type { ServerResponse } from 'node:http';
import type {
  AuthenticatedTokenPrincipal,
  AuthScope,
  HttpHost,
} from '@zhin.js/host-http';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { writeJson } from './http-response.js';

export interface WorkroomRouteOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export type WorkroomPrincipal = Readonly<{ principalId: string }>;

/** Projects a trusted Workroom principal exclusively from the authenticated Host token. */
export function requireWorkroomPrincipal(
  response: ServerResponse,
  authScope: AuthScope,
  authenticatedPrincipal: AuthenticatedTokenPrincipal | undefined,
  error: string,
): WorkroomPrincipal | null {
  if (authScope !== 'full' || !authenticatedPrincipal) {
    writeJson(response, 403, { success: false, error });
    return null;
  }
  return Object.freeze({ principalId: authenticatedPrincipal.principalId });
}

export function rejectWorkroomQueryFields(
  response: ServerResponse,
  url: URL,
  fields: readonly string[],
  error: string,
): boolean {
  if (!fields.some((field) => url.searchParams.has(field))) return false;
  writeJson(response, 400, { success: false, error });
  return true;
}

export function rejectWorkroomBodyFields(
  response: ServerResponse,
  body: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  error: string,
): boolean {
  if (!fields.some((field) => Object.hasOwn(body, field))) return false;
  writeJson(response, 400, { success: false, error });
  return true;
}
