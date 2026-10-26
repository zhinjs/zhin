import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { toolCallerKey } from '../../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../../src/runtime.js';

export default defineAgentTool<{ suffix: string; order?: 'register' | 'renew' | 'transfer' }>({
  description: '比较各注册商的域名价格（nazhumi.com）。suffix 为后缀如 com、.cn、.co.uk；order 为 register/renew/transfer，默认 register。',
  inputSchema: z.object({
    suffix: z.string().min(1).max(63),
    order: z.enum(['register', 'renew', 'transfer']).optional(),
  }),
  keywords: ['域名价格', '域名比价', '注册价格', '续费价格', 'domain price'],
  tags: ['网络', '域名'],
  async execute({ suffix, order }, context) {
    const service = context.use(nettoolsServiceToken);
    const callerKey = toolCallerKey(context);
    return service.run(() => service.domainPrice(suffix, order, callerKey, context.signal, context.locale), context.locale);
  },
});
