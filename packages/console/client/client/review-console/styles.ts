/** 评论审批页在 `pluginUiStyles` 之上的少量版式；颜色与间距全部来自套件 token。 */
export const reviewConsoleStyles = `
.zk-review-draft { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--zk-line); border-radius: var(--zk-radius-lg); background: var(--zk-surface); min-width: 0; }
.zk-review-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; font-size: var(--zk-text-small); color: var(--zk-muted); min-width: 0; }
.zk-review-meta > * { min-width: 0; overflow-wrap: anywhere; }
.zk-review-quote { display: grid; gap: 6px; padding: 10px 14px; border-left: 3px solid var(--zk-line); border-radius: 0 var(--zk-radius-sm) var(--zk-radius-sm) 0; background: var(--zk-inset); }
.zk-review-label { font-size: var(--zk-text-small); color: var(--zk-muted); }
.zk-review-body { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
.zk-review-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding-top: 12px; border-top: 1px solid var(--zk-line); }
.zk-review-actions__end { margin-left: auto; }
.zk-review-resources { display: flex; flex-wrap: wrap; gap: 8px; }
.zk-review-resources a { display: inline-flex; padding: 4px 10px; border-radius: var(--zk-radius-sm); background: var(--zk-inset); text-decoration: none; }
.zk-review-resources .zk-hint { align-self: center; color: var(--zk-danger); }
@media (max-width: 767px) { .zk-review-draft { padding: 12px; } .zk-review-actions__end { margin-left: 0; } }
`;
