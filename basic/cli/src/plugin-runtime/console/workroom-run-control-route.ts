import { readJsonBody } from '@zhin.js/host-http';
import type { WorkroomRunControlCommand } from '@zhin.js/agent';
import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';
import {
  rejectWorkroomBodyFields,
  requireWorkroomPrincipal,
  type WorkroomRouteOptions,
} from './workroom-request-policy.js';

const FORBIDDEN_CONTROL_FIELDS = Object.freeze([
  'principalId', 'authenticatedPrincipalId', 'authority', 'authorization',
]);

export function registerWorkroomRunControlRoute(options: WorkroomRouteOptions): void {
  const { http, base, snapshots } = options;
  http.route('POST', `${base}/agent/workroom/control`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    const principal = requireWorkroomPrincipal(
      response,
      authScope,
      authenticatedPrincipal,
      '需要绑定 principal 的 full scope 才能控制 Workroom Run',
    );
    if (!principal) return;
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (rejectWorkroomBodyFields(
      response,
      body,
      FORBIDDEN_CONTROL_FIELDS,
      'Workroom control 不能携带身份或权威字段',
    )) return;
    const agent = await import('@zhin.js/agent').catch(() => undefined);
    if (!agent) {
      writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未安装' });
      return;
    }
    let command: WorkroomRunControlCommand;
    try {
      command = agent.parseWorkroomRunControlCommand(body);
    } catch (error) {
      writeJson(response, 400, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ workroomControl }) => {
      if (!workroomControl) {
        writeJson(response, 503, { success: false, error: 'Workroom Run 控制面尚未就绪' });
        return;
      }
      try {
        const receipt = await workroomControl.execute(command, principal);
        if (receipt.status === 'stale') {
          writeJson(response, 409, {
            success: false,
            error: 'Workroom Run sequence 已变化',
            data: receipt,
          });
          return;
        }
        writeJson(response, 200, {
          success: true,
          data: {
            status: receipt.status,
            action: receipt.action,
            operationId: receipt.operationId,
            receiptRef: receipt.receiptRef,
            receiptDigest: receipt.receiptDigest,
            run: {
              projectId: receipt.state.projectId,
              runId: receipt.state.runId,
              status: receipt.state.status,
              sequence: receipt.state.sequence,
            },
          },
        });
      } catch (error) {
        if (error instanceof agent.WorkroomRunControlUnauthorizedError) {
          writeJson(response, 403, { success: false, error: error.message });
          return;
        }
        writeJson(response, 409, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Execute authenticated typed Workroom Run control',
    tags: ['agent', 'workroom'],
  });
}
