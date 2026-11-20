import { defineHandler } from 'zhin.js/handler';
import { hasResource } from 'zhin.js';
import { memberWelcomeOwnerToken, outboundMessageToken } from '@zhin.js/core/runtime';
import { groupSuiteConfigFor } from '../../src/config.js';
import { welcomeConversationAllowed } from '../../src/welcome-scope.js';

/** Canonical notice input only; no SDK-specific callbacks or direct platform sends. */
export default defineHandler({
  event: 'notice.receive',
  async handle({ payload: notice }) {
    const config = groupSuiteConfigFor(this as Parameters<typeof groupSuiteConfigFor>[0], notice);
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
    // #1250: the text is an outbound template; the new member is this send's `sender` (the subject
    // of the event), passed as data, so the renderer fills `${sender.name}` / `${menu}` /
    // `${command.*}` for the sending account and never expands placeholders inside the nickname.
    const member = notice.target;
    const result = await this.use(outboundMessageToken).send({
      requester: this.owner.id,
      conversation: notice.conversation,
      content: { type: 'text', data: { text } },
      incoming: {
        sender: { id: member.id, name: member.name || member.id },
        content: '',
        timestamp: notice.timestamp,
      },
    });
    if (result.status !== 'sent') {
      // Unknown delivery must remain visible, and must never trigger an automatic duplicate send.
      throw new Error(`Group welcome delivery ${result.status}`);
    }
  },
});
