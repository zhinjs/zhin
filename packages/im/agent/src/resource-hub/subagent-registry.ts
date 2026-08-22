/**
 * SubAgentRegistry — sub-agent definition management with common/specialized support.
 *
 * Absorbs: core/built/agent-preset.ts (AgentPresetFeature)
 */

import { ResourceRegistry } from './resource-registry.js';
import type { ResourceScope, SubAgentDef, AgentPreset } from './types.js';

export class SubAgentRegistry extends ResourceRegistry<SubAgentDef> {
  private readonly presets = new Map<string, AgentPreset>();

  addPreset(preset: AgentPreset, scope?: ResourceScope, source?: string): () => void {
    this.presets.set(preset.name, preset);
    const def: SubAgentDef = {
      name: preset.name,
      description: preset.description,
      systemPrompt: preset.systemPrompt,
      allowedTools: preset.tools,
      model: preset.model,
    };
    return this.add(def, scope, source);
  }

  removePreset(name: string, scope?: ResourceScope): boolean {
    this.presets.delete(name);
    return this.remove(name, scope);
  }

  getPreset(name: string): AgentPreset | undefined {
    return this.presets.get(name);
  }

  getAllPresets(): AgentPreset[] {
    return Array.from(this.presets.values());
  }

  searchPresets(query: string, options?: { maxResults?: number }): AgentPreset[] {
    const max = options?.maxResults ?? 5;
    const lq = query.toLowerCase();
    return this.getAllPresets()
      .map(p => ({ preset: p, score: this.scorePreset(p, lq) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map(({ preset }) => preset);
  }

  override dispose(): void {
    this.presets.clear();
    super.dispose();
  }

  private scorePreset(p: AgentPreset, lq: string): number {
    let score = 0;
    if (lq.includes(p.name.toLowerCase())) score += 1.0;
    if (p.description.toLowerCase().includes(lq)) score += 0.5;
    return score;
  }
}
