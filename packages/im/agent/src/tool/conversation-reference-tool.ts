import type { PluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../plugin-runtime/capability-ingress.js';
import type { TurnRequest } from '../turn/turn-ingress.js';

const TOOL_NAME = 'inspect_conversation_reference';

export function createConversationReferenceCapability(
  owner: PluginId,
  request: TurnRequest,
): ToolCapability | undefined {
  const references = request.input.references ?? [];
  const port = request.ports.references;
  if (references.length === 0 || !port) return undefined;
  const allowed = new Set(references.map((reference) => reference.key));
  return Object.freeze({
    owner,
    name: TOOL_NAME,
    qualifiedName: TOOL_NAME,
    description: 'Read a quoted message, merged-forward record, or media reference from the current conversation. Only references listed in the current user message are accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        reference: { type: 'string', description: 'Scoped reference key shown in the current message context' },
        depth: { type: 'number', description: 'Nested forward depth, maximum 2' },
      },
      required: ['reference'],
    },
    approval: 'never',
    source: 'builtin:conversation-context',
    async execute<TInput = unknown, TResult = unknown>(input: TInput): Promise<TResult> {
      const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
      const key = typeof args.reference === 'string' ? args.reference : '';
      if (!allowed.has(key)) {
        return Object.freeze({ status: 'forbidden', code: 'reference_not_in_turn' }) as TResult;
      }
      const requestedDepth = typeof args.depth === 'number' && Number.isFinite(args.depth)
        ? Math.floor(args.depth)
        : 1;
      return port.resolve(key, {
        depth: Math.max(0, Math.min(requestedDepth, 2)),
        maxEntries: 50,
        maxChars: 12_000,
      }, request.signal) as Promise<TResult>;
    },
  });
}
