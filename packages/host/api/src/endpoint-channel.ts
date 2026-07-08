/**
 * Console endpoint channel/parent contract helpers.
 * Sub-channel type remains `channel`; parent scene uses `group` | `guild`.
 */

export type ConsoleChannelParentType = "group" | "guild";

export interface ConsoleChannelParent {
  type: ConsoleChannelParentType;
  id: string;
  name?: string;
}

export interface ConsoleChannel {
  id: string;
  name?: string;
  parent?: ConsoleChannelParent;
}

export interface StoredInboxChannelRow {
  channel_id?: unknown;
  channel_name?: unknown;
  channel_parent_type?: unknown;
  channel_parent_id?: unknown;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Validate/normalize parent; legacy `channel` → `guild`. */
export function toConsoleChannelParent(
  raw?: { type?: string; id?: string; name?: string } | null,
): ConsoleChannelParent | undefined {
  if (!raw) return undefined;
  const id = nonEmptyString(raw.id);
  if (!id) return undefined;
  const typeRaw = raw.type;
  let type: ConsoleChannelParentType | undefined;
  if (typeRaw === "group" || typeRaw === "guild") {
    type = typeRaw;
  } else if (typeRaw === "channel") {
    type = "guild";
  }
  if (!type) return undefined;
  const name = nonEmptyString(raw.name);
  return name ? { type, id, name } : { type, id };
}

export function storedParentFields(
  parent?: ConsoleChannelParent | null,
): { channel_parent_type: string | null; channel_parent_id: string | null } {
  if (!parent) {
    return { channel_parent_type: null, channel_parent_id: null };
  }
  return {
    channel_parent_type: parent.type,
    channel_parent_id: parent.id,
  };
}

export function parentFromStoredRow(
  row: StoredInboxChannelRow,
): ConsoleChannelParent | undefined {
  return toConsoleChannelParent({
    type: nonEmptyString(row.channel_parent_type),
    id: nonEmptyString(row.channel_parent_id),
  });
}

export function inboxChannelWhere(
  base: Record<string, unknown>,
  parent?: { type?: string; id?: string } | null,
): Record<string, unknown> {
  const normalized = toConsoleChannelParent(parent ?? undefined);
  if (!normalized) return base;
  return {
    ...base,
    channel_parent_type: normalized.type,
    channel_parent_id: normalized.id,
  };
}

export function channelFromStoredRow(row: StoredInboxChannelRow): ConsoleChannel {
  const id = String(row.channel_id ?? "");
  const name = nonEmptyString(row.channel_name);
  const parent = parentFromStoredRow(row);
  return {
    id,
    ...(name ? { name } : {}),
    ...(parent ? { parent } : {}),
  };
}

export function toConsoleChannel(
  msgChannel?: {
    id?: string;
    type?: string;
    parent?: { type?: string; id?: string };
  } | null,
  names?: { channelName?: string; parentName?: string },
): ConsoleChannel | undefined {
  const id = nonEmptyString(msgChannel?.id);
  if (!id) return undefined;
  const channelName = nonEmptyString(names?.channelName);
  const parent = toConsoleChannelParent(
    msgChannel?.parent
      ? {
          ...msgChannel.parent,
          ...(names?.parentName ? { name: names.parentName } : {}),
        }
      : undefined,
  );
  return {
    id,
    ...(channelName ? { name: channelName } : {}),
    ...(parent ? { parent } : {}),
  };
}
