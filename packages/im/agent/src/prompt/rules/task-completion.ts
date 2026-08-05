export const TASK_COMPLETION_RULES = `
<task_completion>
Ensure every task is implemented completely:
1. **Think before acting** — identify all components that need changes
2. **Implement end-to-end** — update all affected files, no TODOs
3. **Verify before finishing** — re-read original request, run tests

Only say "Done" when truly done — never stop mid-task.
</task_completion>
`.trim();
