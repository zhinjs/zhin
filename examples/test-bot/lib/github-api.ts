/**
 * Runtime `gh *` 命令共享：从当前 generation 的 Adapter projection 取 GithubClient。
 */
import {
  githubClient,
  type GhClient,
  type GithubClient,
} from '@zhin.js/adapter-github';
import type { EndpointClientContext } from 'zhin.js/adapter';

const GITHUB_ENDPOINT = process.env.GITHUB_ENDPOINT_ID?.trim() || 'zhin-dev';

export function ghApiMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'message' in data) {
    const msg = (data as { message?: string }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

function platformFromInput(input: unknown): { adapter?: string; senderId?: string } {
  if (!input || typeof input !== 'object') return {};
  const value = input as Record<string, unknown>;
  if (typeof value.$adapter === 'string') {
    const sender = value.$sender;
    const senderId = sender && typeof sender === 'object'
      ? String((sender as { id?: unknown }).id ?? '')
      : undefined;
    return { adapter: value.$adapter, senderId: senderId || undefined };
  }
  const meta = value.metadata && typeof value.metadata === 'object'
    ? value.metadata as Record<string, unknown>
    : {};
  const adapter = typeof value.adapter === 'string'
    ? value.adapter
    : typeof meta.adapter === 'string'
      ? meta.adapter
      : undefined;
  const senderId = typeof value.sender === 'string'
    ? value.sender
    : typeof meta.senderId === 'string'
      ? meta.senderId
      : undefined;
  return { adapter, senderId };
}

export function resolveGithubEndpoint(context: EndpointClientContext): GithubClient | string {
  try {
    return githubClient.get({ project: context.project }, GITHUB_ENDPOINT);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function resolveGhClient(context: EndpointClientContext): Promise<GhClient | string> {
  const endpoint = resolveGithubEndpoint(context);
  if (typeof endpoint === 'string') return endpoint;
  const { adapter, senderId } = platformFromInput(context.input);
  return endpoint.getUserOrDefaultApi(adapter, senderId);
}

export function requireRepo(args: readonly string[], usage: string): string | { repo: string; rest: string[] } {
  const repo = args[0]?.trim();
  if (!repo) return usage;
  return { repo, rest: [...args.slice(1)] };
}

export function parsePositiveInt(value: string | undefined, label: string): number | string {
  if (value === undefined || value.trim() === '') return `缺少 ${label}`;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return `无效 ${label}: ${value}`;
  return Math.trunc(n);
}
