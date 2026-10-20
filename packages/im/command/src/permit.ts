/**
 * Re-export permit 解析/校验 from @zhin.js/permission (SSOT)。
 * 保留 CommandSession 兼容签名供 command-index 过渡使用。
 */
export {
  type PermitKind,
  type ParsedPermit,
  parsePermitName,
  isBuiltinPermit,
  isPlatformPermit,
  assertPermitSyntax as assertBuiltinPermits,
  checkBuiltinPermit,
  checkBuiltinPermitList,
} from '@zhin.js/permission';
