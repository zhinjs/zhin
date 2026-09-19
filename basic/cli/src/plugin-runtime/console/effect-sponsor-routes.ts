import { readJsonBody, type HttpHost } from '@zhin.js/host-http';
import type { WorkroomEffectSponsorDecisionCommand } from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';

export interface RegisterEffectSponsorRoutesOptions {
  readonly http: HttpHost;
  readonly base: string;
  readonly snapshots?: SnapshotReader;
}

export function registerEffectSponsorRoutes(
  options: RegisterEffectSponsorRoutesOptions,
): void {
  const { http, base, snapshots } = options;
  http.route('POST', `${base}/agent/workroom/effects/sponsor-decisions`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    if (authScope !== 'full' || !authenticatedPrincipal) {
      writeJson(response, 403, { success: false, error: '需要绑定 principal 的 full scope credential' });
      return;
    }
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (Object.hasOwn(body, 'principalId') || Object.hasOwn(body, 'authenticatedPrincipalId')
      || Object.hasOwn(body, 'authority') || Object.hasOwn(body, 'discussion')) {
      writeJson(response, 400, { success: false, error: 'Effect Sponsor decision 不能携带身份、权威或 discussion 字段' });
      return;
    }
    const command = parseEffectSponsorDecisionBody(body);
    if (!command) {
      writeJson(response, 400, {
        success: false,
        error: 'Effect Sponsor decision 仅接受 version:2 与 decision 匹配的 content-free reasonCode',
      });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ effectSponsor }) => {
      if (!effectSponsor) {
        writeJson(response, 503, { success: false, error: 'Effect Sponsor decision control 尚未就绪' });
        return;
      }
      try {
        const record = await effectSponsor.decide(command, {
          principalId: authenticatedPrincipal.principalId,
        });
        writeJson(response, 200, { success: true, data: record });
      } catch (error) {
        writeJson(response, 409, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Submit an authenticated typed Effect Sponsor decision',
    tags: ['agent', 'workroom', 'effect'],
  });
}

function parseEffectSponsorDecisionBody(
  value: Record<string, unknown>,
): Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'> | null {
  const expected = [
    'version', 'operationId', 'projectId', 'runId', 'effectIntentId',
    'effectIntentDigest', 'decision', 'reasonCode', 'decidedAt',
  ].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])
    || value.version !== 2
    || typeof value.operationId !== 'string' || !value.operationId.trim()
    || typeof value.projectId !== 'string' || !value.projectId.trim()
    || typeof value.runId !== 'string' || !value.runId.trim()
    || typeof value.effectIntentId !== 'string' || !value.effectIntentId.trim()
    || typeof value.effectIntentDigest !== 'string' || !value.effectIntentDigest.startsWith('sha256:')
    || !Number.isSafeInteger(value.decidedAt) || (value.decidedAt as number) < 0) return null;
  const decision = value.decision;
  const reasonCode = value.reasonCode;
  if (decision === 'approve') {
    if (reasonCode !== 'approved_as_requested') return null;
  } else if (decision === 'reject') {
    if (!['rejected_policy', 'rejected_scope', 'rejected_risk', 'rejected_by_sponsor'].includes(
      reasonCode as string,
    )) return null;
  } else {
    return null;
  }
  return Object.freeze({ ...value }) as unknown as Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'>;
}
