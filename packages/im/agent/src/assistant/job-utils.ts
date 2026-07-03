export function jobPrompt(job: import('./types.js').ScheduleJob): string {
  if (job.action.kind === 'heartbeat' || job.action.kind === 'agent') {
    return job.action.prompt;
  }
  return '';
}
