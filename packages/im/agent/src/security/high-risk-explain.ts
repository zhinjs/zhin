/**
 * #1250 `high-risk-rules-explain`: the wording of the provenance confirmation card (policy
 * `external-content-confirmation`), in the turn's display language.
 *
 * Nothing here decides anything: the category, the level and the sources come from `provenance.ts`.
 * This module only says which rule put the call in its category and which sources made the turn count
 * as having read content. It names sources by metadata only (source kind, tool name, MCP server name,
 * counts): the card never quotes the content itself, so text from a web page or a background message
 * cannot reach the approver through it, and names are reduced to a safe character set.
 */
import { createMessages, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import type { HighRiskActionKind, HighRiskConfirmLevel, ProvenanceSource } from './provenance.js';
import type { InitiatorTrustLevel } from './trust-level.js';

/** Why a tool is in its high-risk category: a category tag the author set, or the name rule. */
export type HighRiskRuleBasis = 'tag' | 'name';

/** What the card and the `tool_approval` audit row say about the rule behind a confirmation. */
export interface HighRiskRuleExplanation {
  readonly kind: HighRiskActionKind;
  readonly basis: HighRiskRuleBasis;
  /** The level this call asked at (after the `schedule_preview` floor). */
  readonly level: HighRiskConfirmLevel;
  /** The level configured for the category, when it differs from `level`. */
  readonly configuredLevel: HighRiskConfirmLevel;
}

const MAX_SHOWN_SOURCES = 5;
const MAX_NAME_CHARS = 64;

const messages = createMessages({
  // Initiator labels of the source chain
  initiator_owner: { 'zh-CN': '主人的消息', en: 'message from the owner' },
  initiator_trusted_member: { 'zh-CN': '信任成员的消息', en: 'message from a trusted member' },
  initiator_group_member: { 'zh-CN': '群成员的消息', en: 'message from a group member' },
  // Actions (reason line)
  action_shell: { 'zh-CN': '执行命令', en: 'running a command' },
  action_file_write: { 'zh-CN': '写文件', en: 'writing a file' },
  action_outbound: { 'zh-CN': '向其他会话发消息', en: 'messaging another conversation' },
  action_config: { 'zh-CN': '修改配置', en: 'changing configuration' },
  action_schedule: { 'zh-CN': '创建或修改定时任务', en: 'creating or changing a scheduled task' },
  reasonTainted: {
    'zh-CN': '这次{action}发生在读取外部内容之后，外部内容可能夹带了指令。',
    en: 'This call ({action}) comes after the turn read external content, which may carry instructions.',
  },
  reasonAlways: { 'zh-CN': '按配置，{action}每次都需要确认。', en: 'As configured, {action} is confirmed every time.' },
  chain: { 'zh-CN': '来源链：{chain}', en: 'Source chain: {chain}' },
  chainSeparator: { 'zh-CN': ' → ', en: ' → ' },
  chainHidden: { 'zh-CN': '另外 {count} 个来源', en: '{count} more sources' },
  chainCall: { 'zh-CN': '本次调用 {tool}', en: 'this call: {tool}' },
  // Chain items (short)
  chainTool: { 'zh-CN': '工具 {tool} 的结果', en: 'result of tool {tool}' },
  chainToolTrusted: { 'zh-CN': '工具 {tool} 的结果（第一方只读）', en: 'result of tool {tool} (first-party read-only)' },
  chainPrivate: { 'zh-CN': '私聊里的背景消息', en: 'background messages of the private chat' },
  chainGroup: { 'zh-CN': '群聊背景消息', en: 'group background messages' },
  chainConversation: { 'zh-CN': '会话背景消息', en: 'conversation background messages' },
  chainMedia: { 'zh-CN': '图片/媒体的自动描述', en: 'automatic description of images or media' },
  chainScheduled: { 'zh-CN': '定时任务的提示词（创建时已读过{sources}）', en: 'prompt of a scheduled task (read before it was created: {sources})' },
  chainScheduledList: { 'zh-CN': '：{list}', en: '{list}' },
  chainScheduledUnknown: { 'zh-CN': '外部内容', en: 'external content' },
  chainScheduledOther: { 'zh-CN': '另一个定时任务的提示词', en: 'the prompt of another scheduled task' },
  chainUnknownKey: { 'zh-CN': '其他来源', en: 'another source' },
  listSeparator: { 'zh-CN': '、', en: ', ' },
  // Rule line
  rule: { 'zh-CN': '规则：`{tool}` 被当成{category}（{basis}）；{condition}（{level}）。', en: 'Rule: `{tool}` counts as {category} ({basis}); {condition} ({level}).' },
  category_shell: { 'zh-CN': '执行命令', en: 'running a command' },
  category_file_write: { 'zh-CN': '写文件', en: 'a file write' },
  category_outbound: { 'zh-CN': '向其他会话发消息', en: 'messaging another conversation' },
  category_config: { 'zh-CN': '配置修改', en: 'a configuration change' },
  category_schedule: { 'zh-CN': '定时任务操作', en: 'a schedule operation' },
  basisName: { 'zh-CN': '名字规则', en: 'name rule' },
  basisTag: { 'zh-CN': '工具标签 `{tag}`', en: 'tool tag `{tag}`' },
  condition_untrusted_content: {
    'zh-CN': '这一类在本回合读过外部内容后需要确认，第一方只读结果不算',
    en: 'this category asks once the turn read external content; first-party read-only results do not count',
  },
  condition_any_content: {
    'zh-CN': '这一类在本回合读过任何内容后需要确认，第一方只读结果也算',
    en: 'this category asks once the turn read any content, first-party read-only results included',
  },
  condition_always: { 'zh-CN': '这一类按配置每次都需要确认', en: 'this category asks on every call, as configured' },
  condition_off: { 'zh-CN': '这一类不因来源确认', en: 'this category never asks because of sources' },
  previewFloor: {
    'zh-CN': '；`schedule_preview` 会当场执行提示词，配置的 {configured} 至少按 any_content 算',
    en: '; `schedule_preview` runs its prompt right away, so the configured {configured} asks at any_content at least',
  },
  // Sources line (detailed, metadata only)
  sources: { 'zh-CN': '来源：{list}', en: 'Sources: {list}' },
  sourcesSeparator: { 'zh-CN': '；', en: '; ' },
  sourcesHidden: { 'zh-CN': '另外 {count} 个来源', en: '{count} more sources' },
  srcWebPage: { 'zh-CN': '{tool} 读取的网页', en: 'web page read by {tool}' },
  srcWebSearch: { 'zh-CN': '{tool} 的网页搜索结果', en: 'web search results from {tool}' },
  srcFiles: { 'zh-CN': '{tool} 读取的工作区文件', en: 'workspace files read by {tool}' },
  srcKnowledge: { 'zh-CN': '{tool} 检索到的知识库内容', en: 'knowledge base content found by {tool}' },
  srcStored: { 'zh-CN': '{tool} 读出的已存记录（可能由别人或以前的回合写入）', en: 'stored records read by {tool} (others or earlier turns may have written them)' },
  srcSubAgent: { 'zh-CN': '子 Agent 经 {tool} 返回的结果', en: 'sub-agent result returned through {tool}' },
  srcMcp: { 'zh-CN': 'MCP 服务 {server} 的工具 {tool} 的结果', en: 'result of tool {tool} from MCP server {server}' },
  srcTrusted: { 'zh-CN': '{tool} 的第一方只读结果', en: 'first-party read-only result of {tool}' },
  srcTool: { 'zh-CN': '工具 {tool} 返回的结果', en: 'result returned by tool {tool}' },
  srcBackground: { 'zh-CN': '本会话上一回合以来的{scene}背景消息{counts}', en: '{scene}background messages of this conversation since the last turn{counts}' },
  srcScenePrivate: { 'zh-CN': '私聊', en: 'private-chat ' },
  srcSceneGroup: { 'zh-CN': '群聊', en: 'group ' },
  srcSceneChannel: { 'zh-CN': '频道', en: 'channel ' },
  srcSceneNone: { 'zh-CN': '', en: '' },
  srcCounts: { 'zh-CN': '（{messages} 条消息、{events} 个其他事件）', en: ' ({messages} messages, {events} other events)' },
  srcMedia: { 'zh-CN': '识图模型对本条消息里图片/媒体的自动描述', en: 'automatic description of this message\'s images or media by the perception model' },
  srcScheduled: {
    'zh-CN': '本次运行的定时任务提示词：任务是在读过内容之后创建的（创建时读过{sources}）',
    en: 'prompt of this scheduled run: the task was created after reading content ({sources})',
  },
});

type MessageKey = Parameters<typeof messages>[1];

/** Tool names, MCP server names and stored keys are shown with a safe character set only. */
export function safeDisplayName(name: string): string {
  const cleaned = name.normalize('NFKC').replace(/[^\p{L}\p{N}_.:\-]/gu, '_');
  return cleaned.length > MAX_NAME_CHARS ? `${cleaned.slice(0, MAX_NAME_CHARS)}…` : cleaned;
}

const WEB_PAGE_TOOLS = new Set(['web_fetch']);
const WEB_SEARCH_TOOLS = new Set(['web_search']);
const FILE_TOOLS = new Set(['read_file', 'list_dir', 'glob', 'grep', 'get_local_assets']);
const KNOWLEDGE_TOOLS = new Set(['knowledge_search']);
const STORED_TOOLS = new Set(['memory_search', 'todo_read', 'get_self_profile']);
/** ADR 0048 collaboration tools whose result is a sub-agent's answer or board entry. */
const SUB_AGENT_TOOLS = new Set(['ask', 'delegate', 'follow_up', 'board_read']);

/** Which rule put `tool` in category `kind` (the category itself comes from `classifyHighRiskAction`). */
export function highRiskRuleBasis(tool: Readonly<{ tags?: readonly string[] }>, kind: HighRiskActionKind): HighRiskRuleBasis {
  return (tool.tags ?? []).includes(kind) ? 'tag' : 'name';
}

/** Stable id of a rule for the audit row, e.g. `schedule.name` or `outbound.tag`. */
export function highRiskRuleId(rule: Pick<HighRiskRuleExplanation, 'kind' | 'basis'>): string {
  return `${rule.kind}.${rule.basis}`;
}

/** Distinct source kinds of a chain, in order of arrival (audit `sourceKinds`). */
export function provenanceSourceKinds(sources: readonly ProvenanceSource[]): readonly string[] {
  return Object.freeze([...new Set(sources.map(source => source.kind))]);
}

function t(locale: Locale | undefined, key: MessageKey, params?: Record<string, string | number>): string {
  return messages(resolveLocale(locale), key, params);
}

/** The short chain shown since #727, e.g. `主人的消息 → 工具 web_fetch 的结果 → 本次调用 bash`. */
export function describeProvenanceChain(
  sources: readonly ProvenanceSource[],
  initiator: InitiatorTrustLevel,
  toolName: string,
  locale?: Locale,
): string {
  const shown = sources.slice(0, MAX_SHOWN_SOURCES).map(source => chainItem(source, locale));
  const hidden = sources.length - shown.length;
  return [
    t(locale, `initiator_${initiator}`),
    ...shown,
    ...(hidden > 0 ? [t(locale, 'chainHidden', { count: hidden })] : []),
    t(locale, 'chainCall', { tool: safeDisplayName(toolName) }),
  ].join(t(locale, 'chainSeparator'));
}

/** The reason and chain lines (the pre-#1250 card text). */
export function describeProvenanceReason(kind: HighRiskActionKind, chain: string, tainted: boolean, locale?: Locale): string {
  const action = t(locale, `action_${kind}`);
  if (!tainted) return `${t(locale, 'reasonAlways', { action })}\n${t(locale, 'chain', { chain })}`;
  return `${t(locale, 'reasonTainted', { action })}\n${t(locale, 'chain', { chain })}`;
}

/** `规则：…` line: the category, the rule behind it and the level the call asked at. */
export function describeHighRiskRule(toolName: string, rule: HighRiskRuleExplanation, locale?: Locale): string {
  const basis = rule.basis === 'tag' ? t(locale, 'basisTag', { tag: rule.kind }) : t(locale, 'basisName');
  const floor = rule.configuredLevel !== rule.level ? t(locale, 'previewFloor', { configured: rule.configuredLevel }) : '';
  return t(locale, 'rule', {
    tool: safeDisplayName(toolName),
    category: t(locale, `category_${rule.kind}`),
    basis,
    condition: t(locale, `condition_${rule.level}`) + floor,
    level: rule.level,
  });
}

/** `来源：…` line: what each recorded source is, by metadata only; undefined when nothing was recorded. */
export function describeProvenanceSources(sources: readonly ProvenanceSource[], locale?: Locale): string | undefined {
  if (!sources.length) return undefined;
  const shown = sources.slice(0, MAX_SHOWN_SOURCES).map(source => sourceDetail(source, locale));
  const hidden = sources.length - shown.length;
  return t(locale, 'sources', {
    list: [...shown, ...(hidden > 0 ? [t(locale, 'sourcesHidden', { count: hidden })] : [])].join(t(locale, 'sourcesSeparator')),
  });
}

/** The whole provenance reason of the card: reason, chain, rule and sources. */
export function formatProvenanceCardReason(input: Readonly<{
  toolName: string;
  rule: HighRiskRuleExplanation;
  sources: readonly ProvenanceSource[];
  initiator: InitiatorTrustLevel;
  tainted: boolean;
  locale?: Locale;
}>): string {
  const chain = describeProvenanceChain(input.sources, input.initiator, input.toolName, input.locale);
  const sources = describeProvenanceSources(input.sources, input.locale);
  return [
    describeProvenanceReason(input.rule.kind, chain, input.tainted, input.locale),
    describeHighRiskRule(input.toolName, input.rule, input.locale),
    ...(sources ? [sources] : []),
  ].join('\n');
}

function chainItem(source: ProvenanceSource, locale?: Locale): string {
  switch (source.kind) {
    case 'tool_result':
      return t(locale, source.trusted ? 'chainToolTrusted' : 'chainTool', { tool: safeDisplayName(source.toolName) });
    case 'conversation_context': return chainConversation(source.scene, locale);
    case 'media_perception': return t(locale, 'chainMedia');
    case 'scheduled_prompt': return t(locale, 'chainScheduled', { sources: scheduledSources(source.sources, locale) });
  }
}

/** #1250: a private chat has no group; a stored key does not keep the scene. */
function chainConversation(scene: 'private' | 'group' | 'channel' | undefined, locale?: Locale): string {
  switch (scene) {
    // ADR 0067 D8: the initiator's own original messages never count, so this is someone else's or rewritten content.
    case 'private': return t(locale, 'chainPrivate');
    case 'group':
    case 'channel': return t(locale, 'chainGroup');
    default: return t(locale, 'chainConversation');
  }
}

function scheduledSources(keys: readonly string[] | undefined, locale?: Locale): string {
  const shown = (keys ?? []).slice(0, MAX_SHOWN_SOURCES).map(key => persistedSource(key, locale));
  return shown.length
    ? t(locale, 'chainScheduledList', { list: shown.join(t(locale, 'listSeparator')) })
    : t(locale, 'chainScheduledUnknown');
}

/** Renders a key written by `TurnProvenance.snapshotForSchedule`; stored keys are data, never shown raw. */
function persistedSource(key: string, locale?: Locale): string {
  if (key.startsWith('tool:')) {
    const trusted = key.endsWith(':trusted');
    const name = key.slice('tool:'.length, trusted ? -':trusted'.length : undefined);
    return t(locale, trusted ? 'chainToolTrusted' : 'chainTool', { tool: safeDisplayName(name) });
  }
  if (key === 'conversation_context') return chainConversation(undefined, locale);
  if (key === 'media_perception') return t(locale, 'chainMedia');
  if (key === 'scheduled_prompt') return t(locale, 'chainScheduledOther');
  return t(locale, 'chainUnknownKey');
}

function sourceDetail(source: ProvenanceSource, locale?: Locale): string {
  switch (source.kind) {
    case 'tool_result': {
      const tool = safeDisplayName(source.toolName);
      if (source.trusted) return t(locale, 'srcTrusted', { tool });
      if (source.mcpServer !== undefined) return t(locale, 'srcMcp', { tool, server: safeDisplayName(source.mcpServer) });
      if (WEB_PAGE_TOOLS.has(source.toolName)) return t(locale, 'srcWebPage', { tool });
      if (WEB_SEARCH_TOOLS.has(source.toolName)) return t(locale, 'srcWebSearch', { tool });
      if (FILE_TOOLS.has(source.toolName)) return t(locale, 'srcFiles', { tool });
      if (KNOWLEDGE_TOOLS.has(source.toolName)) return t(locale, 'srcKnowledge', { tool });
      if (STORED_TOOLS.has(source.toolName)) return t(locale, 'srcStored', { tool });
      if (SUB_AGENT_TOOLS.has(source.toolName)) return t(locale, 'srcSubAgent', { tool });
      return t(locale, 'srcTool', { tool });
    }
    case 'conversation_context': {
      const scene = source.scene === 'private' ? 'srcScenePrivate'
        : source.scene === 'group' ? 'srcSceneGroup'
          : source.scene === 'channel' ? 'srcSceneChannel' : 'srcSceneNone';
      const counts = source.messages !== undefined || source.events !== undefined
        ? t(locale, 'srcCounts', { messages: source.messages ?? 0, events: source.events ?? 0 }) : '';
      return t(locale, 'srcBackground', { scene: t(locale, scene), counts });
    }
    case 'media_perception': return t(locale, 'srcMedia');
    case 'scheduled_prompt': return t(locale, 'srcScheduled', { sources: scheduledSources(source.sources, locale) });
  }
}
