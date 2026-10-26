import { defineCommand } from 'zhin.js/command';
import { commandCallerKey } from '../../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../../src/runtime.js';

export default defineCommand({
  description: '域名注册/续费/转入价格比价（nazhumi.com）', descriptionI18n: { en: "Compare domain registration, renewal and transfer prices (nazhumi.com)" },
  alias: ['域名比价'],
  params: {
    suffix: { type: 'string', description: '域名后缀（com、.cn、.co.uk）或完整域名', descriptionI18n: { en: "Domain suffix (com, .cn, .co.uk) or a full domain" } },
    order: { type: 'string', description: '注册(register) / 续费(renew) / 转入(transfer)，默认注册', descriptionI18n: { en: "register (default), renew, or transfer" } },
  },
  async execute({ params, input, use, signal, locale }) {
    const service = use(nettoolsServiceToken);
    const suffix = String(params.suffix ?? '');
    const order = params.order == null ? undefined : String(params.order);
    const callerKey = commandCallerKey(input);
    return service.run(() => service.domainPrice(suffix, order, callerKey, signal, locale), locale);
  },
});
