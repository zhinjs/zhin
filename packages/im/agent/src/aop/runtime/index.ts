/**
 * Runtime plane — ZhinAgent 执行器 + ResourceHub（MCP/Skill/工具注册）。
 *
 * AgentOrchestrator 不再是 conductor，定位为资源枢纽（ADR 0024 D1）；
 * 这里以 ResourceHub 别名暴露其语义。
 */
export { ZhinAgent } from '../../zhin-agent/index.js';
export { AgentOrchestrator, AgentOrchestrator as ResourceHub } from '../../orchestrator/index.js';
