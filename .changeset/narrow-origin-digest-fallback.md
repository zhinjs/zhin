---
"@zhin.js/core": patch
---
入站来源判定的摘要兜底仅用于 group/channel 会话；Registry 就绪且账号已知的发送者不再走摘要匹配；摘要命中最多映射为 peer_bot / member（只记录），不再映射为被丢弃的 self，修复真人复读 Bot 文本被静默丢弃。plugin-runtime/im 入口改为具名导出 MessageOrigin、isMessageOrigin、RoomMembershipPort、roomMembershipToken，来源分类器实现细节标 @internal。
