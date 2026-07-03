/**
 * Inbound plane — 薄 AOP 入站管线（enrich → peerPolicy → dispatch）。
 * 迁移期 re-export collaboration 下的实现；register-ai-trigger 仅注册 handler。
 */
export {
  createInboundTurnPipeline,
} from '../../collaboration/inbound-turn-pipeline.js';
export type {
  InboundTurnPipeline,
  InboundTurnPipelineDeps,
} from '../../collaboration/inbound-turn-pipeline.js';
