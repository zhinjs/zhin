import { type AgentMessage, detectTone } from '@zhin.js/ai';
import { resolveCollaborationTurnHint } from '../collaboration/collaboration-context.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { BuildContext, ContextBuilder, ContextInjector, InjectContext } from './contracts.js';
export class ProfileContextBuilder implements ContextBuilder {
  name = 'profile';

  constructor(private readonly host: ZhinAgentPrivate) {}

  async build(context: BuildContext): Promise<AgentMessage[]> {
    if (!context.envelope) return [];
    const userId = context.message.$sender.id || 'unknown';
    const summary = await this.host.userProfiles.buildProfileSummary(userId);
    if (summary?.trim()) {
      context.envelope.profileSummary = summary;
    }
    return [];
  }
}

export class CollaborationContextBuilder implements ContextBuilder {
  name = 'collaboration';

  async build(context: BuildContext): Promise<AgentMessage[]> {
    if (!context.envelope) return [];
    const hint = resolveCollaborationTurnHint(context.message, context.inboundContent);
    if (hint) {
      context.envelope.collaborationHint = hint;
    }
    return [];
  }
}

export class ToneInjector implements ContextInjector {
  name = 'tone';

  constructor(private readonly host: ZhinAgentPrivate) {}

  inject(messages: AgentMessage[], context: InjectContext): AgentMessage[] {
    if (context.envelope && context.inboundContent !== undefined) {
      context.envelope.toneHint = this.host.config.toneAwareness
        ? detectTone(context.inboundContent).hint
        : '';
    }
    return messages;
  }
}

export function createDefaultContextBuilders(host: ZhinAgentPrivate): {
  builders: ContextBuilder[];
  injectors: ContextInjector[];
} {
  return {
    builders: [
      new ProfileContextBuilder(host),
      new CollaborationContextBuilder(),
    ],
    injectors: [new ToneInjector(host)],
  };
}
