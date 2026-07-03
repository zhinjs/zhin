import type { AiOutboundCapabilities, AiOutboundExtensionDefinition } from './types.js';

export const AI_OUTBOUND_JSON_EXAMPLE = '{"mentions":["researcher","210723495"],"text":"正文"}';

export function buildCoreAiOutboundPromptHint(
  capabilities?: AiOutboundCapabilities,
): string {
  const lines = [
    'When your reply must @ peers, send rich media, buttons, or delegate — output JSON only (no Markdown wrapper):',
    AI_OUTBOUND_JSON_EXAMPLE,
    'mentions: peer endpoint ID or pipelineRole; text: message body.',
    'Do NOT write "@researcher" in plain text — the framework converts JSON mentions to real platform @ segments.',
  ];
  if (capabilities?.richSegments?.length) {
    lines.push(`Rich segments (optional "segments" array): ${capabilities.richSegments.join(', ')}.`);
  }
  if (capabilities?.interactive === 'native') {
    lines.push('Interactive buttons: use extensions field per adapter schema.');
  }
  return lines.join('\n');
}

export function buildAiOutboundPromptHint(input: {
  capabilities?: AiOutboundCapabilities;
  extensions?: readonly AiOutboundExtensionDefinition[];
  rosterLines?: string[];
  forceJsonOnly?: boolean;
}): string {
  const lines: string[] = [];
  if (input.rosterLines?.length) {
    lines.push(...input.rosterLines);
  }
  lines.push(buildCoreAiOutboundPromptHint(input.capabilities));
  if (input.extensions?.length) {
    lines.push('Adapter extensions (optional "extensions" object):');
    for (const ext of input.extensions) {
      lines.push(`- ${ext.key}: see platform schema`);
      if (ext.examples[0]) lines.push(`  example: ${ext.examples[0]}`);
    }
  }
  if (input.forceJsonOnly) {
    lines.push(
      'MUST reply with JSON only when @ peers or handoff — no Markdown body with plain "@role" text.',
    );
  }
  return lines.join('\n');
}

/** 检测入站是否含 handoff / @ 意图（协作群 structured_only 信号）。 */
export function detectInboundHandoffIntent(content: string): boolean {
  const t = content.trim();
  if (!t) return false;
  if (t.includes('@')) return true;
  return /依次|自我介绍|叫大家|请各位|handoff|delegate/i.test(t);
}
