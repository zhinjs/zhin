import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { toolCallerKey } from '../../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../../src/runtime.js';

export default defineAgentTool<{ host: string }>({
  description: '从全球多个地区 Ping 一个公网域名或 IP（check-host.net），返回各地延迟与丢包。拒绝内网、回环和云元数据地址。',
  inputSchema: z.object({ host: z.string().min(1).max(255) }),
  keywords: ['ping', '延迟', '连通性', '丢包', '多地ping'],
  tags: ['网络', '诊断'],
  async execute({ host }, context) {
    const service = context.use(nettoolsServiceToken);
    const callerKey = toolCallerKey(context);
    return service.run(() => service.ping(host, callerKey, context.signal, context.locale), context.locale);
  },
});
