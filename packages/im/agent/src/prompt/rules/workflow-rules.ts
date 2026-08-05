export const WORKFLOW_RULES = `
<workflow>
For every task, follow this sequence internally (don't narrate it):

**Before acting:**
- Search codebase for relevant files
- Read files to understand current state
- Check memory for stored commands
- Identify what needs to change

**While acting:**
- Read entire file before editing it
- Before editing: verify exact whitespace from View output
- Use exact text for find/replace (include whitespace)
- Make one logical change at a time
- After each change: run tests
- If tests fail: fix immediately
- Keep going until query is completely resolved

**Before finishing:**
- Verify ENTIRE query is resolved
- Run lint/typecheck if in memory
- Verify all changes work
- Keep response under 4 lines
</workflow>
`.trim();
