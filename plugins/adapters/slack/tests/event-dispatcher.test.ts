import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackEventDispatcher } from '../src/event-dispatcher.js';
import type { SlackEndpoint } from '../src/endpoint.js';

function createMockEndpoint(): SlackEndpoint {
  const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() };
  const emit = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue('msg-id');
  return {
    $config: { name: 'test-ep', context: 'slack', token: 'xoxb-mock', signingSecret: 'mock' },
    $id: 'test-ep',
    $platformUserId: 'UBOT',
    logger,
    adapter: { emit, sendMessage, plugin: { logger } },
    client: { chat: { delete: vi.fn() } },
    senderPermitCache: new Map(),
    messageChannelMap: new Map(),
    trackMessageChannel: vi.fn(),
    getUserInfo: vi.fn(),
    getChannelInfo: vi.fn(),
  } as any;
}

describe('SlackEventDispatcher', () => {
  let endpoint: ReturnType<typeof createMockEndpoint>;
  let dispatcher: SlackEventDispatcher;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    endpoint = createMockEndpoint();
    dispatcher = new SlackEventDispatcher(endpoint);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('routeEvent — message', () => {
    it('should emit message.receive for message events', async () => {
      await dispatcher.routeEvent({
        type: 'message',
        ts: '1700000000.000000',
        user: 'U12345',
        channel: 'C001',
        channel_type: 'channel',
        text: 'hello',
      } as any);

      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'slack', $channel: { id: 'C001', type: 'group' } }),
      );
    });

    it('should ignore bot_message subtypes', async () => {
      await dispatcher.routeEvent({
        type: 'message',
        subtype: 'bot_message',
        ts: '1700000000.000000',
        channel: 'C001',
        text: 'bot says hi',
      } as any);

      expect(endpoint.adapter.emit).not.toHaveBeenCalled();
    });

    it('should ignore duplicate channel message when app_mention follows', async () => {
      await dispatcher.routeEvent({
        type: 'message',
        ts: '1700000000.000000',
        user: 'U12345',
        channel: 'C001',
        channel_type: 'channel',
        text: '<@UBOT> hello',
      } as any);
      await dispatcher.routeEvent({
        type: 'app_mention',
        ts: '1700000000.000000',
        user: 'U12345',
        channel: 'C001',
        channel_type: 'channel',
        text: '<@UBOT> hello',
      } as any);

      expect(endpoint.adapter.emit).toHaveBeenCalledTimes(1);
      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $id: 'C001:1700000000.000000' }),
      );
    });

    it('should emit message.receive for app_mention events', async () => {
      await dispatcher.routeEvent({
        type: 'app_mention',
        ts: '1700000000.000000',
        user: 'U12345',
        channel: 'C001',
        channel_type: 'channel',
        text: '<@UBOT> hello',
      } as any);

      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({ $adapter: 'slack' }),
      );
    });
  });

  describe('routeEvent — notice', () => {
    it('should emit notice.receive for member_joined_channel', async () => {
      await dispatcher.routeEvent({
        type: 'member_joined_channel',
        user: 'U12345',
        channel: 'C001',
        event_ts: '1700000000.000000',
      } as any);

      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'notice.receive',
        expect.objectContaining({ $scene_type: 'group', $sub_type: 'member_increase' }),
      );
    });
  });

  describe('routeInteraction — block_actions', () => {
    it('should emit message.receive for button clicks', () => {
      dispatcher.routeInteraction({
        type: 'block_actions',
        user: { id: 'U12345', username: 'alice' },
        channel: { id: 'C001' },
        message: { ts: '1700000000.000000' },
        response_url: 'https://hooks.slack.com/actions/abc',
        actions: [{
          type: 'button',
          action_id: 'vote_yes',
          block_id: 'block1',
          text: { type: 'plain_text', text: 'Yes' },
          value: 'yes',
          action_ts: '1700000001.000000',
        }],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://hooks.slack.com/actions/abc',
        expect.objectContaining({
          body: expect.stringContaining('已收到'),
        }),
      );
      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({
          $adapter: 'slack',
          $sender: expect.objectContaining({ id: 'U12345' }),
        }),
      );
    });
  });

  describe('routeSlashCommand', () => {
    it('should emit message.receive for slash commands', () => {
      dispatcher.routeSlashCommand({
        token: 'mock',
        team_id: 'T001',
        channel_id: 'C001',
        channel_name: 'general',
        user_id: 'U12345',
        user_name: 'alice',
        command: '/hello',
        text: 'world',
        response_url: 'https://hooks.slack.com/...',
        trigger_id: 'trigger123',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://hooks.slack.com/...',
        expect.objectContaining({
          body: expect.stringContaining('处理中…'),
        }),
      );
      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({
          $raw: '/hello world',
          $sender: expect.objectContaining({ id: 'U12345' }),
        }),
      );
    });
  });

  describe('routeEvent — assistant_thread_started', () => {
    it('should emit message.receive for assistant thread', async () => {
      await dispatcher.routeEvent({
        type: 'assistant_thread_started',
        assistant_thread: {
          user_id: 'U12345',
          context: {},
          channel_id: 'D001',
          thread_ts: '1700000000.000000',
        },
      } as any);

      expect(endpoint.adapter.emit).toHaveBeenCalledWith(
        'message.receive',
        expect.objectContaining({
          $channel: expect.objectContaining({ id: 'D001', type: 'private' }),
        }),
      );
    });
  });
});
