/** No provider traffic: a poll completes only when its exact connection is aborted. */
export function idleIlinkUpdates(options: { abortSignal?: AbortSignal }) {
  return new Promise<{ msgs: []; get_updates_buf: string }>(resolve => {
    if (options.abortSignal?.aborted) resolve({ msgs: [], get_updates_buf: '' });
    else options.abortSignal?.addEventListener('abort', () => resolve({ msgs: [], get_updates_buf: '' }), { once: true });
  });
}
export const idleIlinkTransport = {
  notifyStart: async () => ({}), notifyStop: async () => ({}),
  getUpdates: idleIlinkUpdates,
};
