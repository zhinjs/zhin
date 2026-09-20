import { readJsonBody } from '@zhin.js/host-http';
import type { PortfolioSponsorCommand } from '@zhin.js/agent/runtime';
import { withGenerationAgentConsole } from './agent-console.js';
import { writeJson } from './http-response.js';
import {
  rejectWorkroomBodyFields,
  rejectWorkroomQueryFields,
  requireWorkroomPrincipal,
  type WorkroomRouteOptions,
} from './workroom-request-policy.js';

const PRINCIPAL_QUERY_FIELDS = Object.freeze(['principalId']);
const FORBIDDEN_COMMAND_FIELDS = Object.freeze([
  'principalId', 'authenticatedPrincipalId', 'authority', 'discussion',
]);

export function registerPortfolioSponsorRoutes(
  options: WorkroomRouteOptions,
): void {
  const { http, base, snapshots } = options;
  http.route('GET', `${base}/agent/workroom/portfolio`, async (
    _request, response, url, authScope, authenticatedPrincipal,
  ) => {
    const principal = requireWorkroomPrincipal(
      response,
      authScope,
      authenticatedPrincipal,
      '需要绑定 principal 的 full scope 才能读取 Portfolio Sponsor projection',
    );
    if (!principal || rejectWorkroomQueryFields(
      response, url, PRINCIPAL_QUERY_FIELDS, 'principalId 只能来自认证 token',
    )) return;
    const portfolioId = url.searchParams.get('portfolioId')?.trim() ?? '';
    if (!portfolioId) {
      writeJson(response, 400, { success: false, error: '请提供 portfolioId 查询参数' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ portfolioSponsor }) => {
      if (!portfolioSponsor) {
        writeJson(response, 503, { success: false, error: 'Portfolio Sponsor projection 尚未就绪' });
        return;
      }
      const result = await portfolioSponsor.read(portfolioId, principal);
      if (result.status === 'forbidden') {
        writeJson(response, 403, { success: false, error: '无权读取该 Portfolio 的 Sponsor projection' });
        return;
      }
      writeJson(response, 200, { success: true, data: result.projection });
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Read content-free Portfolio Sponsor projection',
    tags: ['agent', 'workroom', 'portfolio'],
  });

  http.route('POST', `${base}/agent/workroom/portfolio/commands`, async (
    request, response, _url, authScope, authenticatedPrincipal,
  ) => {
    const principal = requireWorkroomPrincipal(
      response, authScope, authenticatedPrincipal, '需要绑定 principal 的 full scope credential',
    );
    if (!principal) return;
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    if (rejectWorkroomBodyFields(
      response,
      body,
      FORBIDDEN_COMMAND_FIELDS,
      'Sponsor command 不能携带身份、权威或 discussion 字段',
    )) return;
    const portfolioId = typeof body.portfolioId === 'string' ? body.portfolioId.trim() : '';
    const command = body.command as PortfolioSponsorCommand | undefined;
    if (!portfolioId || !command || typeof command !== 'object') {
      writeJson(response, 400, { success: false, error: '请提供 typed portfolioId/command' });
      return;
    }
    const handled = await withGenerationAgentConsole(snapshots, async ({ portfolioSponsor }) => {
      if (!portfolioSponsor) {
        writeJson(response, 503, { success: false, error: 'Portfolio Sponsor command 尚未就绪' });
        return;
      }
      try {
        const projection = await portfolioSponsor.execute(portfolioId, command, principal);
        writeJson(response, 200, { success: true, data: projection });
      } catch (error) {
        writeJson(response, 409, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (!handled) writeJson(response, 503, { success: false, error: 'Agent Runtime 尚未就绪' });
  }, {
    summary: 'Execute authenticated typed Portfolio Sponsor command',
    tags: ['agent', 'workroom', 'portfolio'],
  });
}
