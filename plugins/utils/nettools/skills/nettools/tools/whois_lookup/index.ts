import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { toolCallerKey } from '../../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../../src/runtime.js';

export default defineAgentTool<{ domain: string }>({
  description: '通过 RDAP 查询域名注册信息：注册商、注册/到期时间、状态、DNS 服务器、DNSSEC。',
  inputSchema: z.object({ domain: z.string().min(1).max(255) }),
  keywords: ['whois', 'rdap', '域名注册信息', '到期时间', '注册商'],
  tags: ['网络', '域名'],
  async execute({ domain }, context) {
    const service = context.use(nettoolsServiceToken);
    const callerKey = toolCallerKey(context);
    return service.run(() => service.whois(domain, callerKey, context.signal, context.locale), context.locale);
  },
});
