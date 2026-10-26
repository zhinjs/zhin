import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { toolCallerKey } from '../../../../src/cooldown.js';
import { SUPPORTED_DNS_TYPES } from '../../../../src/dns.js';
import { nettoolsServiceToken } from '../../../../src/runtime.js';

export default defineAgentTool<{ name: string; type?: string }>({
  description: `通过 DNS-over-HTTPS 查询 DNS 记录。type 可选 ${SUPPORTED_DNS_TYPES.join('/')}，默认 A；PTR 时 name 可为 IP。`,
  inputSchema: z.object({
    name: z.string().min(1).max(255),
    type: z.string().max(10).optional(),
  }),
  keywords: ['dns', '解析', 'nslookup', 'dig', 'mx', 'txt', 'cname'],
  tags: ['网络', '域名'],
  async execute({ name, type }, context) {
    const service = context.use(nettoolsServiceToken);
    const callerKey = toolCallerKey(context);
    return service.run(() => service.dns(name, type, callerKey, context.signal, context.locale), context.locale);
  },
});
