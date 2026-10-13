// Test transport for time only; the real PluginScheduleHost owns admission and callback context.
export function manualScheduleHost() {
  const jobs = new Set();
  const registered = [];
  return {
    registered,
    host: {
      register(job) { jobs.add(job); registered.push(job); return () => jobs.delete(job); },
      list() { return [...jobs].filter(job => job.isActive?.() ?? true); },
    },
    async tick() {
      for (const job of [...jobs]) if (job.isActive?.() ?? true) await job.execute();
    },
  };
}
