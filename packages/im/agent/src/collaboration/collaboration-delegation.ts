/**
 * Pipeline 协作委派识别与 handback 摘要（传输层 harness）。
 */
import type { Message } from '@zhin.js/core';
import { extractEmbeddedAiOutboundJson } from '@zhin.js/core';
import type { CollaborationScene, PipelineArtifactKind } from './types.js';
import { findActiveDelegation } from './delegation-state.js';

export function messageTextContent(message: Message): string {
  const parts: string[] = [];
  for (const seg of message.$content) {
    if (seg.type === 'text' && seg.data?.text) {
      parts.push(String(seg.data.text).trim());
    }
  }
  return parts.join(' ').trim();
}

export function resolvePlannerEndpointId(cell: CollaborationScene): string | undefined {
  return cell.members.find((m) => m.pipelineRole === 'planner')?.endpointId;
}

/** 模型把 cell_* 工具返回值原样贴到群里的 JSON blob。 */
export function isCellToolResultJson(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o.ok !== true) return false;
    if (typeof o.collaborationSceneId === 'string') return true;
    if (o.pipelineState != null) return true;
    if (typeof o.artifactId === 'string') return true;
    if (Array.isArray(o.artifacts)) return true;
    if (Array.isArray(o.runs)) return true;
    if (o.reviewerSlice != null) return true;
    if (typeof o.stage === 'string' && Array.isArray(o.allowedNextStages)) return true;
    if (
      typeof o.kind === 'string'
      && typeof o.runId === 'string'
      && ['report', 'blueprint', 'deliverable', 'review', 'citations'].includes(o.kind)
    ) {
      return true;
    }
    if (
      typeof o.action === 'string'
      && ['create', 'reset', 'update', 'activate', 'list'].includes(o.action)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 从混合正文中剥离内嵌的 legacy cell_* 工具 JSON（保留其余可读文本）。 */
export function removeEmbeddedCellToolJsonFromText(text: string): string {
  const result = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (full, inner: string) => {
    if (isCellToolResultJson(String(inner).trim())) return ' ';
    return full;
  });

  let out = '';
  let i = 0;
  while (i < result.length) {
    const start = result.indexOf('{', i);
    if (start === -1) {
      out += result.slice(i);
      break;
    }
    out += result.slice(i, start);
    let depth = 0;
    let end = -1;
    for (let j = start; j < result.length; j++) {
      if (result[j] === '{') depth++;
      else if (result[j] === '}') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      out += result.slice(start);
      break;
    }
    const candidate = result.slice(start, end + 1);
    if (isCellToolResultJson(candidate.trim())) {
      i = end + 1;
    } else {
      out += candidate;
      i = end + 1;
    }
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** 从被委派方出站正文提取公开回复摘要（剥离 JSON handback / markdown 围栏 / 工具 JSON）。 */
export function summarizeDelegateeReply(text: string): string {
  let t = removeEmbeddedCellToolJsonFromText(text.trim());
  if (!t) return '已完成。';
  if (isCellToolResultJson(t)) return '已完成。';
  t = t.replace(/```(?:json)?\s*[\s\S]*?```/gi, ' ').replace(/\s+/g, ' ').trim();
  const embedded = extractEmbeddedAiOutboundJson(t);
  if (embedded?.prose) t = embedded.prose.trim();
  t = removeEmbeddedCellToolJsonFromText(t);
  if (isCellToolResultJson(t)) return '已完成。';
  t = t.replace(/(?:已通过公开回复完成|交还给\s*Planner|hand\s*back\s*to\s*planner)[^.!?。！？]*[.!?。！？]?/gi, '').trim();
  if (!t) return '已完成。';
  return t;
}

/** Kernel / 群协作 handback：须为实质公开内容，不能只有「已完成」。 */
export function isSubstantiveGroupTaskReply(text: string): boolean {
  const t = summarizeDelegateeReply(text).trim();
  if (!t || t === '已完成。') return false;
  if (/^已完成[。.!！?？\s✅✓]*$/u.test(t)) return false;
  if (/^已完成/u.test(t) && t.length < 40) return false;
  return t.length >= 12;
}

/** 剥离模型贴到回复里的 cell_* 工具 JSON（勿发到群）。 */
export function stripCellToolJsonFromOutputElements(
  elements: import('@zhin.js/ai').OutputElement[],
): import('@zhin.js/ai').OutputElement[] {
  const kept: import('@zhin.js/ai').OutputElement[] = [];
  for (const el of elements) {
    if (el.type !== 'text' || !el.content?.trim()) {
      kept.push(el);
      continue;
    }
    const trimmed = el.content.trim();
    if (isCellToolResultJson(trimmed)) continue;
    const cleaned = removeEmbeddedCellToolJsonFromText(el.content);
    if (!cleaned.trim()) continue;
    kept.push(cleaned === el.content ? el : { ...el, content: cleaned });
  }
  return kept;
}

/** 被委派方 turn hint：上一棒角色与委派期望（legacy activeDelegations；kernel 路径见 formatPlannerHandbackHint）。 */
function artifactSubmitInstructions(kinds: PipelineArtifactKind[]): string[] {
  const brief: Record<PipelineArtifactKind, string> = {
    report: 'report:{summary,findings[]}',
    citations: 'citations:{sources:[{title,url,snippet}]}',
    blueprint: 'blueprint:{decision,steps[]}',
    deliverable: 'deliverable:{summary,changes[]}',
    review: 'review:{approved,feedback}',
  };
  const kindsLine = kinds.map((k) => brief[k] ?? k).join('; ');
  return [
    `Required artifact kinds (legacy): ${kindsLine}`,
    'Public reply = short summary only; use orchestration_status for kernel tasks.',
  ];
}

export function formatActiveDelegationHint(
  cell: CollaborationScene,
  endpointId: string,
): string | undefined {
  const delegation = findActiveDelegation(cell, endpointId);
  if (!delegation) return undefined;
  const lines = [
    `[Active delegation] From Planner; mode=${delegation.mode ?? 'pipeline'}.`,
    `Task: ${delegation.delegateText.trim() || '(see group history)'}`,
  ];
  if (delegation.requireArtifact) {
    const kinds = delegation.artifactKinds ?? [];
    lines.push(
      `Required artifacts: ${kinds.join(', ') || '(kinds missing — handback blocked)'}`,
    );
    if (kinds.length) {
      lines.push(...artifactSubmitInstructions(kinds));
    }
    lines.push('Legacy pipeline artifacts are deprecated; prefer orchestration_status + internal_room handback.');
  } else {
    lines.push('No artifact required; brief public summary is enough.');
  }
  lines.push(
    'Complete only YOUR part. Hand back via separate JSON {"mentions":["planner"],"text":"已完成。"}',
  );
  return lines.join('\n');
}

/** Planner 收到成员 handback @ 时的 turn 指引。 */
export function formatPlannerHandbackHint(_cell: CollaborationScene): string | undefined {
  return [
    '[Kernel handback] A peer task completed (internal_room) or an im_projection handback arrived.',
    'Check orchestration_status for results; #taskId in group text applies only to im_projection.',
    'Dispatch the next peer with orchestration_add_task(executor="internal_room", assigned_to="<endpointId>").',
    'Add project_to_im: true when humans should see an @ in the group.',
  ].join('\n');
}
