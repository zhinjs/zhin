import { type AgentMessage, detectTone } from '@zhin.js/ai';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';
import type { BuildContext, ContextBuilder, ContextInjector, InjectContext } from './contracts.js';
import { isAmbientTurn } from '../user-relation-turn.js';
import { getLogger } from '@zhin.js/logger';

const logger = getLogger('ProfileContext');
export class ProfileContextBuilder implements ContextBuilder {
  name = 'profile';

  constructor(private readonly host: ZhinAgentPrivate) {}

  async build(context: BuildContext): Promise<AgentMessage[]> {
    if (!context.envelope) return [];
    const userId = context.turn.principal.subjectId;
    const summary = await this.host.userProfiles.buildProfileSummary(userId);
    const relation = await this.buildRelationSummary(context);
    const combined = [summary, relation].filter((part) => part?.trim()).join('\n');
    if (combined.trim()) {
      context.envelope.profileSummary = combined;
    }
    return [];
  }

  /**
   * 画像 + 好感度：私聊与被叫到的群/频道回合注入发起人；旁听回合额外带上同场景最近活跃的 1–2 人。
   * 读失败不影响回合。
   */
  private async buildRelationSummary(context: BuildContext): Promise<string> {
    const { origin, principal } = context.turn;
    if (origin.kind !== 'im') return '';
    const relations = this.host.userProfiles.relations;
    if (!relations) return '';
    try {
      const isMaster = principal.roles.includes('master');
      const record = await relations.get(origin.platform, principal.subjectId);
      const ambient = isAmbientTurn(context.turn as Parameters<typeof isAmbientTurn>[0]);
      const others = ambient && origin.scope !== 'private'
        ? await relations.recentActives(origin.platform, `${origin.scope}:${origin.sceneId}`, principal.subjectId, 1)
        : [];
      return relations.buildSummary(record, {
        isMaster,
        others,
        sender: { platform: origin.platform, userId: principal.subjectId, displayName: principal.displayName },
      });
    } catch (error) {
      logger.warn(`relation summary skipped: ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  }
}

/** 会话画像：群/频道回合注入 `[Session]` 段（话题、管理员、成员概况）。读失败不影响回合。 */
export class SessionContextBuilder implements ContextBuilder {
  name = 'session';

  constructor(private readonly host: ZhinAgentPrivate) {}

  async build(context: BuildContext): Promise<AgentMessage[]> {
    const { origin } = context.turn;
    if (!context.envelope || origin.kind !== 'im' || origin.scope === 'private') return [];
    const sessions = this.host.userProfiles.sessions;
    if (!sessions) return [];
    try {
      const summary = sessions.buildSummary(await sessions.get(origin.platform, origin.scope, origin.sceneId));
      if (summary) context.envelope.sessionSummary = summary;
    } catch (error) {
      logger.warn(`session summary skipped: ${error instanceof Error ? error.message : String(error)}`);
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
      new SessionContextBuilder(host),
    ],
    injectors: [new ToneInjector(host)],
  };
}
