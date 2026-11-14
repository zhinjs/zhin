/**
 * Tool tag that declares a tool's ordinary approval (`requiresApproval: always / once / on-risk`) may be given
 * by an admin initiator in their own private chat (#1250 review). Without it only the bot owner approves.
 * `requiresApproval: 'human'` and dangerous (hard-gate) tools always need the bot owner, tag or not.
 */
export const ADMIN_APPROVABLE_TOOL_TAG = 'admin_approvable';
