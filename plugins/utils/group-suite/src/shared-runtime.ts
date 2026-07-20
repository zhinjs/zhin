export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ts(): string {
  return new Date().toISOString();
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Runtime Message → group/global context */
export function resolveContextKey(input: {
  target?: string;
  metadata?: Readonly<Record<string, unknown>>;
}): { type: string; id: string } {
  const meta = input.metadata ?? {};
  const channelType = String(meta.type ?? meta.channelType ?? '');
  if (channelType === 'group' || channelType === 'guild') {
    return { type: 'group', id: String(input.target ?? meta.channelId ?? '') };
  }
  if (input.target && channelType !== 'private') {
    return { type: 'group', id: String(input.target) };
  }
  return { type: 'global', id: '' };
}

export function resolveSender(input: {
  sender?: string;
  metadata?: Readonly<Record<string, unknown>>;
}): { id: string; name: string } {
  const meta = input.metadata ?? {};
  const id = String(input.sender ?? meta.senderId ?? '');
  const name = String(meta.senderName ?? meta.name ?? '用户');
  return { id, name };
}
