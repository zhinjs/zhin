/**
 * @zhin.js/a2a — A2A v1.0 server plugin for Zhin.js Host.
 *
 * Auto-exposes one Agent Card per `ai.agents[]` entry at:
 *   GET  /a2a/{agentName}/.well-known/agent-card.json
 *   POST /a2a/{agentName}/jsonrpc
 *   *    /a2a/{agentName}/rest/*
 */
import { formatCompact, usePlugin } from '@zhin.js/core';
import type { Router, RouterContext } from '@zhin.js/host-router';
import { paramPath } from '@zhin.js/host-router';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
import type { AgentCard } from '@a2a-js/sdk';
import { AGENT_CARD_PATH } from '@a2a-js/sdk';
import { getAgentRuntimeRegistry } from '@zhin.js/agent';
import type { AIService } from '@zhin.js/agent';
import { resolvePublicBaseUrl, a2aAgentBasePath } from './config.js';
import { verifyA2aBearer } from './auth.js';
import { buildAgentCardForBinding, listExposableAgentNames } from './card-builder.js';
import { ZhinA2AExecutor } from './agent-executor.js';
import { handleAgentCard, handleJsonRpc, handleRest } from './http-handlers.js';

interface AgentA2AStack {
  agentName: string;
  requestHandler: A2ARequestHandler;
  agentCard: AgentCard;
}

const A2A_ROUTE = '/a2a/:agentName/:tail+';

const plugin = usePlugin();
const { root, useContext, logger, onDispose } = plugin;

let agentStacks = new Map<string, AgentA2AStack>();
let httpToken = '';
let publicBaseUrl = 'http://127.0.0.1:8086';

function rebuildAgentStacks(ai: AIService): void {
  const registry = ai.getBindingRegistry();
  publicBaseUrl = resolvePublicBaseUrl(
    root.inject('config')?.get<{ http?: { host?: string; port?: number; publicUrl?: string } }>('zhin.config.yml') ?? {},
  );
  const runtime = getAgentRuntimeRegistry();
  const primaryAgent = runtime.getDefault();
  const next = new Map<string, AgentA2AStack>();

  for (const agentName of listExposableAgentNames(registry)) {
    const card = buildAgentCardForBinding(agentName, registry, publicBaseUrl);
    if (!card || !primaryAgent) continue;

    const executor = new ZhinA2AExecutor({
      agentName,
      getAgent: () => runtime.getDefault(),
      resolveBinding: () => registry.getBinding(agentName),
    });

    const requestHandler = new DefaultRequestHandler(
      card,
      new InMemoryTaskStore(),
      executor,
    );

    next.set(agentName, { agentName, requestHandler, agentCard: card });
  }

  agentStacks = next;
  logger.info(formatCompact({ A2A: 'ready', agents: [...next.keys()].join(',') }));
}

function parseA2aTail(tail: string): { kind: 'card' | 'jsonrpc' | 'rest'; restSubPath?: string } | null {
  const normalized = tail.replace(/^\/+/, '');
  if (normalized === `.well-known/${AGENT_CARD_PATH}` || normalized === '.well-known/agent-card.json') {
    return { kind: 'card' };
  }
  if (normalized === 'jsonrpc' || normalized.startsWith('jsonrpc/')) {
    return { kind: 'jsonrpc' };
  }
  if (normalized === 'rest' || normalized.startsWith('rest/')) {
    const restSubPath = normalized === 'rest' ? '' : normalized.slice('rest/'.length);
    return { kind: 'rest', restSubPath };
  }
  return null;
}

function ensureStacks(ai: AIService | undefined): void {
  if (agentStacks.size > 0 || !ai?.isReady()) return;
  rebuildAgentStacks(ai);
}

function sendJsonViaRawRes(ctx: RouterContext, status: number, body: unknown): void {
  ctx.respond = false;
  ctx.res.writeHead(status, { 'Content-Type': 'application/json' });
  ctx.res.end(JSON.stringify(body));
}

useContext('router', (router: Router) => {
  const configService = root.inject('config');
  const appConfig = configService?.get<{ http?: { token?: string; host?: string; port?: number; publicUrl?: string } }>('zhin.config.yml') ?? {};
  httpToken = appConfig.http?.token ?? '';
  publicBaseUrl = resolvePublicBaseUrl(appConfig);

  const ai = root.inject('ai') as AIService | undefined;
  if (ai?.isReady()) rebuildAgentStacks(ai);

  const a2aHandler = async (ctx: RouterContext): Promise<void> => {
    const agentName = decodeURIComponent(ctx.params.agentName ?? '');
    const parsed = parseA2aTail(paramPath(ctx, 'tail'));
    if (!parsed) {
      sendJsonViaRawRes(ctx, 404, { error: 'Not found' });
      return;
    }

    const aiNow = root.inject('ai') as AIService | undefined;
    ensureStacks(aiNow);

    if (httpToken && !verifyA2aBearer(ctx.req, httpToken)) {
      sendJsonViaRawRes(ctx, 401, { error: 'Unauthorized — Bearer token required' });
      return;
    }

    const stack = agentStacks.get(agentName);
    if (!stack) {
      sendJsonViaRawRes(ctx, 404, { error: `A2A agent "${agentName}" not found` });
      return;
    }

    ctx.respond = false;
    const preParsedBody = ctx.method === 'POST' ? ctx.request.body : undefined;

    try {
      if (parsed.kind === 'card') {
        await handleAgentCard(ctx.req, ctx.res, stack.requestHandler);
      } else if (parsed.kind === 'jsonrpc') {
        await handleJsonRpc(ctx.req, ctx.res, stack.requestHandler, preParsedBody);
      } else {
        await handleRest(ctx.req, ctx.res, stack.requestHandler, parsed.restSubPath ?? '', preParsedBody);
      }
    } catch (err) {
      logger.error('A2A request error:', err);
      if (!ctx.res.headersSent) {
        sendJsonViaRawRes(ctx, 500, { error: 'Internal server error' });
      }
    }
  };

  router.all(A2A_ROUTE, a2aHandler);

  logger.info(formatCompact({ A2A: 'listening', base: `${publicBaseUrl}${a2aAgentBasePath('{agent}')}` }));

  onDispose(() => {
    agentStacks.clear();
  });
});

// Rebuild when AI service becomes ready (late init)
useContext('ai', (ai: AIService) => {
  if (ai.isReady()) rebuildAgentStacks(ai);
  return () => {
    agentStacks.clear();
  };
});

import type {} from '@zhin.js/host-router';
