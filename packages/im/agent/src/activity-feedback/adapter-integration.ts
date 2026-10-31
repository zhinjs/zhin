import type { ConversationRef, MessageRef } from '@zhin.js/im-contract';
import type { CapturedOutboundOperation } from '@zhin.js/plugin-runtime';
import {
  MessageTypingIndicator, NativeTypingIndicator, NoneTypingIndicator, ReactionTypingIndicator,
  type TypingIndicatorAdapter, type TypingIndicatorType,
} from '../typing-indicator/index.js';
import { buildTypingSendContent } from '../typing-indicator/adapter-integration.js';

export { PLATFORM_FEATURES, buildTypingSendContent, type PlatformFeatures } from '../typing-indicator/adapter-integration.js';

/** Operations have already captured one concrete account incarnation and full scene. */
export type ActivityFeedbackIO = Omit<CapturedOutboundOperation, 'signal' | 'release'>;

/** Adapt existing indicator strategies to captured operations without fabricating an Endpoint. */
export function createActivityFeedbackAdapter(input: Readonly<{
  platform: string;
  io: ActivityFeedbackIO;
}>): TypingIndicatorAdapter {
  const { platform, io } = input;
  const messages = new Map<string, MessageRef>();
  const ref = (id: string): MessageRef => ({ conversation: io.target, id });
  const supportedTypes: TypingIndicatorType[] = [];
  if (io.addReaction && io.removeReaction) supportedTypes.push('reaction');
  if (io.typing) supportedTypes.push('typing');
  if (io.recall) supportedTypes.push('message');
  supportedTypes.push('none');
  return {
    platform, supportedTypes,
    createIndicator(options, config) {
      if (config.type === 'reaction' && io.addReaction && io.removeReaction) {
        return new ReactionTypingIndicator(options, config,
          (id, emoji) => io.addReaction!(ref(id), emoji,
            { sceneType: io.target.kind, channelId: io.target.id }),
          (id, reactionId) => io.removeReaction!(ref(id), reactionId));
      }
      if (config.type === 'typing' && io.typing) {
        return new NativeTypingIndicator(options, config,
          () => io.typing!(io.target, true), () => io.typing!(io.target, false));
      }
      if (config.type === 'message' && io.recall) {
        return new MessageTypingIndicator(options, config, async (current, text) => {
          const content = buildTypingSendContent(platform, current, text);
          if (!content) return null;
          const id = await io.send(content, { locale: current.locale });
          if (id) messages.set(id, ref(id));
          return id ?? null;
        }, async id => {
          const message = messages.get(id);
          if (message) await io.recall!(message);
          messages.delete(id);
        }, async (id, content) => {
          const message = messages.get(id);
          if (message && io.edit) await io.edit(message, content);
        });
      }
      return new NoneTypingIndicator();
    },
  };
}
