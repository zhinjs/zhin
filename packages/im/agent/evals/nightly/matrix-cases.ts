/**
 * Model capability matrix (#724 → #723): one small case per capability, run
 * against every configured model. Each case is a single model request with
 * semantic checks, so results compare across models and across nights.
 */
import { z, type LlmTool } from '@zhin.js/ai';
import { semantic, type ModelObservation, type SemanticCheck } from './semantic.js';

export type Capability = 'tool-call-format' | 'parallel-calls' | 'long-context' | 'zh-instruction';

export interface CapabilityCase {
  readonly id: string;
  readonly capability: Capability;
  readonly description: string;
  readonly systemPrompt: string;
  readonly user: string;
  readonly tools?: readonly LlmTool[];
  readonly checks: (observation: ModelObservation) => readonly SemanticCheck[];
}

const weatherTool: LlmTool = {
  name: 'get_weather',
  description: 'Look up the current weather for one city. Call once per city.',
  parameters: z.object({ city: z.string().describe('City name, e.g. 上海') }),
};

const TOOL_SYSTEM = '你是一个助手。需要实时信息时必须调用提供的工具，不要编造结果。';

/** ~10k CJK characters of filler with one fact buried in the middle. */
export function buildHaystack(needle: string, paragraphs = 120): string {
  const filler = '这是一段用于测试长上下文检索的背景材料，记录了项目例会的常规讨论，没有任何特殊信息。';
  const parts: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    parts.push(`第${i + 1}段：${filler}`);
    if (i === Math.floor(paragraphs / 2)) parts.push(`第${i + 1}段补充：${needle}`);
  }
  return parts.join('\n');
}

const NEEDLE_CODE = '青柠-4721';

export const CAPABILITY_MATRIX: readonly CapabilityCase[] = [
  {
    id: 'matrix-tool-call-format',
    capability: 'tool-call-format',
    description: 'Emits a well-formed call to the offered tool with a schema-valid argument.',
    systemPrompt: TOOL_SYSTEM,
    user: '上海现在天气怎么样？',
    tools: [weatherTool],
    checks: (o) => [semantic.calledTool(o, 'get_weather'), semantic.toolArgMatches(o, 'get_weather', 'city', /上海|shanghai/i)],
  },
  {
    id: 'matrix-parallel-calls',
    capability: 'parallel-calls',
    description: 'Issues independent tool calls together in one response.',
    systemPrompt: `${TOOL_SYSTEM}多个互不依赖的查询应在同一轮中并行调用。`,
    user: '同时帮我查一下北京和广州现在的天气。',
    tools: [weatherTool],
    checks: (o) => [
      semantic.calledTool(o, 'get_weather', 2),
      semantic.toolArgsCover(o, 'get_weather', 'city', [/北京|beijing/i, /广州|guangzhou/i]),
    ],
  },
  {
    id: 'matrix-long-context',
    capability: 'long-context',
    description: 'Retrieves one fact buried in ~10k characters of context.',
    systemPrompt: '根据用户提供的材料回答问题，只输出答案本身。',
    user: `${buildHaystack(`会议约定的暗号是「${NEEDLE_CODE}」。`)}\n\n问题：材料里约定的暗号是什么？`,
    checks: (o) => [semantic.textIncludes(o, NEEDLE_CODE)],
  },
  {
    id: 'matrix-zh-instruction',
    capability: 'zh-instruction',
    description: 'Follows a Chinese formatting instruction exactly (language, count, prefix).',
    systemPrompt: '严格遵守用户的格式要求。',
    user: '用中文给出三条早睡的好处。要求：恰好三行，每行以「- 」开头，不要标题、不要总结、不要英文。',
    checks: (o) => [semantic.bulletLines(o, '- ', 3), semantic.textIsChinese(o)],
  },
];
