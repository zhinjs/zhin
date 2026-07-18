import { defineCommand } from '@zhin.js/command';

export default defineCommand({
  description: 'GitHub 快捷指令帮助',
  execute: () => [
    'GitHub 指令列表：',
    '',
    '  gh repo <owner/repo>           — 查看仓库信息',
    '  gh issues <owner/repo>         — 列出 Issue',
    '  gh issue <owner/repo> <编号>   — 查看某个 Issue',
    '  gh prs <owner/repo>            — 列出 PR',
    '  gh pr <owner/repo> <编号>      — 查看某个 PR',
    '  gh search <关键词>             — 搜索仓库',
    '  gh star <owner/repo>           — Star 仓库',
    '  gh unstar <owner/repo>         — 取消 Star',
    '  gh commits <owner/repo> [数量] — 查看提交记录',
    '  gh branches <owner/repo>       — 查看分支',
    '  gh releases <owner/repo>       — 查看发布',
    '  gh ci <owner/repo>             — 查看 CI 状态',
    '  gh comment <owner/repo> <编号> <内容> — 评论 Issue/PR',
    '  gh close <owner/repo> <编号>   — 关闭 Issue/PR',
    '  gh whoami                      — Bot / App + 用户绑定状态',
    '  gh bind [PAT]                  — 绑定 GitHub（PAT 或 Device Flow）',
    '  gh unbind                      — 解绑 GitHub 账号',
  ].join('\n'),
});
