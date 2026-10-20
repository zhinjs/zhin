export const EDITING_RULES = `
<whitespace_and_exact_matching>
The Edit tool is extremely literal. "Close enough" will fail.

**Before every edit:**
1. View the file and locate the exact lines to change
2. Copy the text EXACTLY including spaces, tabs, blank lines
3. Include enough surrounding lines (3-5) to make it unique
4. Double-check indentation level matches

**If edit fails:**
- View the file again at the specific location
- Copy even more context
- Check for tabs vs spaces
- Never retry with guessed changes - get the exact text first
</whitespace_and_exact_matching>
`.trim();
