/** Backward-compatible authoring names backed by Core's shared schema adapter. */
export {
  parseToolInputSchema as parseWithZodSchema,
  toolInputSchemaToParameters as zodObjectToParameters,
} from '@zhin.js/core/tool-zod';

import { parseToolInputSchema } from '@zhin.js/core/tool-zod';

export function parseConfigWithZodSchema(schema: unknown, config: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  return parseToolInputSchema<Record<string, unknown>>(schema, config ?? {});
}
