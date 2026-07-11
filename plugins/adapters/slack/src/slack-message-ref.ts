/** Slack 消息定位：channel + ts（Activity Feedback / recall / reaction 共用） */

export function formatSlackMessageRef(channel: string, ts: string): string {
  return `${channel}:${ts}`;
}

export function parseSlackMessageRef(ref: string): { channel: string; ts: string } | null {
  const sep = ref.indexOf(':');
  if (sep <= 0) return null;
  const channel = ref.slice(0, sep);
  const ts = ref.slice(sep + 1);
  if (!channel || !ts) return null;
  return { channel, ts };
}

export function slackMessageTs(ref: string): string {
  return parseSlackMessageRef(ref)?.ts ?? ref;
}
