import { capabilityId, definePlugin, rootPluginId } from 'zhin.js';
import { adapterFeatureId } from 'zhin.js/adapter';
import { commandFeedbackToken, commandMenuPresentationToken } from 'zhin.js/command';
import { outboundPresentationToken } from 'zhin.js/middleware';

// Replace these example identities with the exact conversation your adapter reports.
const textTarget = {
  endpoint: { id: capabilityId(rootPluginId(), adapterFeatureId, 'test'), adapter: 'test' },
  kind: 'channel',
  id: 'support',
  parent: { kind: 'group', id: 'team' },
  threadId: 'daily',
} as const;

export default definePlugin({
  name: 'behavior-customization',
  setup({ resources }) {
    // Select these providers in the application Root, not a mounted child plugin.
    resources.provide(commandFeedbackToken, (feedback, { conversation }) => {
      if (feedback.status === 'denied' && conversation.kind === 'private') {
        return '此指令需要管理员权限，请联系管理员。';
      }
      return undefined; // Keep built-in validation and other feedback.
    });

    // The framework still owns catalog selection, pagination and navigation buttons.
    resources.provide(commandMenuPresentationToken, ({ page }) => page.text);

    // A pure decision: do not send, mutate state or perform network requests here.
    resources.provide(outboundPresentationToken, ({ conversation }) => {
      if (conversation.endpoint.id === textTarget.endpoint.id
        && conversation.endpoint.adapter === textTarget.endpoint.adapter
        && conversation.kind === textTarget.kind && conversation.id === textTarget.id
        && conversation.parent?.kind === textTarget.parent.kind
        && conversation.parent.id === textTarget.parent.id
        && conversation.threadId === textTarget.threadId) {
        return { html: 'text', markdown: 'text', interactive: 'text' };
      }
      return undefined; // Keep the adapter's normal presentation everywhere else.
    });
  },
});
