import type { AgentPromptSection } from '@zhin.js/core';

export function sortAgentPromptSections(sections: AgentPromptSection[]): AgentPromptSection[] {
  return [...sections].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export function truncateAgentPromptText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return text.slice(0, maxChars - 1) + '…';
}

export function applyAgentPromptLimits(
  sections: AgentPromptSection[],
  sectionMaxChars: number,
  totalMaxChars: number,
): AgentPromptSection[] {
  const out: AgentPromptSection[] = [];
  let used = 0;
  for (const section of sortAgentPromptSections(sections)) {
    const body = truncateAgentPromptText(section.body.trim(), sectionMaxChars);
    if (!body) continue;
    const titleLen = section.title ? section.title.length + 2 : 0;
    if (used + titleLen + body.length > totalMaxChars) {
      const remain = totalMaxChars - used - titleLen;
      if (remain <= 0) break;
      out.push({ ...section, body: truncateAgentPromptText(body, remain) });
      break;
    }
    out.push({ ...section, body });
    used += titleLen + body.length;
  }
  return out;
}

export function formatAgentPromptSectionsMarkdown(sections: AgentPromptSection[]): string {
  if (sections.length === 0) return '';
  const blocks = sections.map(s => {
    const head = s.title?.trim() ? `${s.title.trim()}\n\n` : '';
    return `${head}${s.body.trim()}`;
  });
  return blocks.join('\n\n');
}
