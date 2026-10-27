/** Keep internal qualified names out of the question when a tool describes its action. */
export function approvalActionLabel(toolName: string, description?: string): string {
  return description?.trim().split(/[\n。；;]/u)[0]?.trim()
    || toolName.split('__').at(-1) || toolName;
}
