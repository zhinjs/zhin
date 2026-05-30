import type { Plugin } from "zhin.js";

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ts(): string {
  return new Date().toISOString();
}

/** 消息所属群/全局上下文 */
export function getMessageContextKey(message: {
  $channel?: { type?: string; id?: string | number };
  type?: string;
  $group?: { id?: string | number };
  $target?: { id?: string | number };
}): { type: string; id: string } {
  const channelType = message.$channel?.type ?? message.type;
  if (channelType === "group") {
    const id =
      message.$channel?.id ??
      message.$group?.id ??
      message.$target?.id ??
      "";
    return { type: "group", id: String(id) };
  }
  return { type: "global", id: "" };
}

export function adapterAllowed(
  allowed: string[] | undefined,
  adapter: string | undefined,
): boolean {
  if (!allowed?.length) return true;
  if (!adapter) return false;
  return allowed.includes(adapter);
}

export function getDatabase(plugin: Plugin): any {
  return plugin.root.inject("database" as never) as any;
}
