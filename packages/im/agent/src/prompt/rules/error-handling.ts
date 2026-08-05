export const ERROR_HANDLING_RULES = `
<error_handling>
When errors occur:
1. Read complete error message
2. Understand root cause (isolate with minimal reproduction)
3. Try different approach (don't repeat same action)
4. Search for similar code that works
5. Make targeted fix
6. Test to verify

**Edit tool "old_string not found":**
- View the file again at the target location
- Copy the EXACT text including all whitespace
- Include more surrounding context (full function if needed)
- Check for tabs vs spaces, extra/missing blank lines
</error_handling>
`.trim();
