/**
 * Slack 适配器类型定义
 */

export interface SlackEndpointConfig {
  context: "slack";
  token: string;
  name: string;
  signingSecret: string;
  appToken?: string;
  socketMode?: boolean;
  /** Socket Mode 客户端 ping 超时（ms），默认 15000 */
  clientPingTimeout?: number;
  port?: number;
}

/** Slack Events API event_callback 外层包装 */
export interface SlackEventEnvelope {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  event: SlackEvent;
  type: "event_callback";
  event_id?: string;
  event_time?: number;
  authorizations?: unknown[];
}

/** Slack URL verification challenge */
export interface SlackUrlVerification {
  type: "url_verification";
  token: string;
  challenge: string;
}

/** Slack interactive payload (block_actions, etc.) */
export interface SlackInteractionPayload {
  type: "block_actions" | "message_action" | "shortcut" | "view_submission" | "view_closed";
  trigger_id?: string;
  user: { id: string; username?: string; name?: string; team_id?: string };
  channel?: { id: string; name?: string };
  message?: { ts: string; text?: string; [key: string]: unknown };
  actions?: SlackBlockAction[];
  response_url?: string;
  [key: string]: unknown;
}

export interface SlackBlockAction {
  type: string;
  action_id: string;
  block_id: string;
  value?: string;
  text?: { type: string; text: string };
  action_ts?: string;
  [key: string]: unknown;
}

/** Slack slash command payload */
export interface SlackSlashCommand {
  token: string;
  team_id: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  api_app_id?: string;
}

/** Union of known Slack event shapes */
export interface SlackEvent {
  type: string;
  ts?: string;
  event_ts?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  text?: string;
  thread_ts?: string;
  subtype?: string;
  [key: string]: unknown;
}

/** Slack message event (narrowed from SlackEvent) */
export type SlackMessageEvent = SlackEvent & {
  type: "message" | "app_mention";
  ts: string;
  channel: string;
};

/** Assistant thread events */
export interface SlackAssistantThreadStarted extends SlackEvent {
  type: "assistant_thread_started";
  assistant_thread: {
    user_id: string;
    context: Record<string, unknown>;
    channel_id: string;
    thread_ts: string;
  };
}

export interface SlackAssistantThreadContextChanged extends SlackEvent {
  type: "assistant_thread_context_changed";
  assistant_thread: {
    user_id: string;
    context: Record<string, unknown>;
    channel_id: string;
    thread_ts: string;
  };
}
