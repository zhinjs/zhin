/** Strip `<think>...</think>` blocks that some reasoning models embed in content. */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

/**
 * Strip hallucinated tool-call markup that some models emit as plain text.
 * Only removes the markup; any surrounding real text is preserved.
 */
export function stripHallucinatedToolCalls(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(/<tool_call\b[\s\S]*?(?:\/>|<\/tool_call>)/gi, '');
  cleaned = cleaned.replace(/<tool_result\b[\s\S]*?(?:\/>|<\/tool_result>)/gi, '');
  cleaned = cleaned.replace(/<function=[^>]*>[\s\S]*?<\/function>/gi, '');
  cleaned = cleaned.replace(/\{tool_(?:result|call)\}/gi, '');
  cleaned = cleaned.replace(/<\|plugin\|>[\s\S]*?<\|\/plugin\|>/gi, '');
  cleaned = cleaned.replace(/<<<tool_call>>>[\s\S]*?<<<end>>>/gi, '');
  return cleaned.trim();
}

