import type { WebClient, ChatStartStreamArguments, ChatAppendStreamArguments } from '@slack/web-api';
import { createEndpointOperation } from 'zhin.js/adapter';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { slackDeliveryError } from './web-client.js';
import { ErrorCode } from '@slack/web-api';

type StreamContent = Pick<ChatAppendStreamArguments, 'markdown_text' | 'chunks'>;
type StreamTarget = Pick<ChatStartStreamArguments, 'channel' | 'thread_ts' | 'recipient_team_id' | 'recipient_user_id'>;
type StreamClient = Pick<WebClient['chat'], 'startStream' | 'appendStream' | 'stopStream'>;

/** Slack's native stream always uses one content mode and one confirmed message identity. */
export function createSlackNativeStream(chat: StreamClient, target: StreamTarget, signal?: AbortSignal) {
  const operation = createEndpointOperation({ signal });
  let ts: string | undefined;
  let mode: 'markdown_text' | 'chunks' | undefined;
  let stopped = false;
  let finalizedByPlatform = false;
  let failure: EndpointDeliveryError | undefined;

  function assertOpen() {
    if (failure) throw failure;
    if (stopped) throw new EndpointDeliveryError('stream_closed', 'Slack stream is closed', 'not_sent');
  }
  function contentMode(content: StreamContent) {
    const next = content.markdown_text !== undefined ? 'markdown_text' : 'chunks';
    if (content.markdown_text !== undefined && content.chunks !== undefined
      || content.markdown_text === undefined && content.chunks === undefined
      || mode && mode !== next) {
      throw new EndpointDeliveryError('invalid_payload', 'Slack stream content mode cannot change', 'not_sent');
    }
    mode = next;
  }
  function wasFinalized(error: unknown): boolean {
    const result = error as { code?: unknown; data?: { error?: unknown } } | undefined;
    // Slack documents that timed-out streams retain all previously accepted content.
    // Only this explicit response with an existing identity proves the container is final.
    if (!ts || result?.code !== ErrorCode.PlatformError || result.data?.error !== 'message_not_in_streaming_state') return false;
    stopped = true; finalizedByPlatform = true;
    return true;
  }

  return {
    get messageTs() { return ts; },
    get finalizedByPlatform() { return finalizedByPlatform; },
    async append(content: StreamContent): Promise<string> {
      assertOpen();
      contentMode(content);
      try {
        const response = ts
          ? await operation.run(() => chat.appendStream({ channel: target.channel, ts: ts!, ...content }))
          : await operation.run(() => chat.startStream({ ...target, ...content }));
        if (!ts) {
          if (typeof response.ts !== 'string' || !response.ts.trim()) {
            throw new EndpointDeliveryError('delivery_unconfirmed', 'Slack stream returned no message timestamp', 'unknown');
          }
          ts = response.ts;
        }
        return ts!;
      } catch (error) {
        if (wasFinalized(error)) throw new EndpointDeliveryError('stream_expired', 'Slack finalized the existing stream', 'not_sent');
        failure = slackDeliveryError(error); throw failure;
      }
    },
    async stop(): Promise<string | undefined> {
      if (failure) throw failure;
      if (stopped) return ts;
      assertOpen();
      if (!ts) { stopped = true; return undefined; }
      try {
        await operation.run(() => chat.stopStream({ channel: target.channel, ts: ts! }));
        stopped = true;
        return ts;
      } catch (error) {
        if (wasFinalized(error)) return ts;
        failure = slackDeliveryError(error); throw failure;
      }
    },
  };
}
