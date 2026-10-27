import { defineHandler } from 'zhin.js/handler';
import { hasResource } from 'zhin.js';
import { memberWelcomeOwnerToken, outboundMessageToken } from '@zhin.js/core/runtime';
import { resolveGroupSuiteConfig, type GroupSuiteConfig } from '../../src/config.js';
import { welcomeConversationAllowed } from '../../src/welcome-scope.js';

/** Canonical notice input only; no SDK-specific callbacks or direct platform sends. */
export default defineHandler({
  event: 'notice.receive',
  async handle({ payload: notice }) {
    const config = resolveGroupSuiteConfig(this.config as Partial<GroupSuiteConfig>);
    const text = config.welcomeMessage;
    if (!text || notice.name !== 'notice.group.member_increase'
      || notice.conversation?.kind !== 'group' || !notice.target?.id) return;
    if (!welcomeConversationAllowed(config.welcomeConversations, notice.conversation)) return;
    // #1012 A9 option 2: once the Agent session welcome (session-ops `welcome.enabled`) owns this
    // conversation, MemberLifecycle sends the single welcome with its own gates; this plugin stays silent.
    if (hasResource(this, memberWelcomeOwnerToken)) {
      const owner = this.use(memberWelcomeOwnerToken);
      if (owner.ownsWelcome(notice.conversation)) return;
    }
    const content = text.replaceAll('{name}', notice.target.name ?? notice.target.id)
      .replaceAll('{id}', notice.target.id);
    const result = await this.use(outboundMessageToken).send({
      requester: this.owner.id,
      conversation: notice.conversation,
      content: { type: 'text', data: { text: content } },
    });
    if (result.status !== 'sent') {
      // Unknown delivery must remain visible, and must never trigger an automatic duplicate send.
      throw new Error(`Group welcome delivery ${result.status}`);
    }
  },
});
