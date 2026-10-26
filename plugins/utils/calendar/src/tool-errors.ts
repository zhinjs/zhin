import type { Locale } from 'zhin.js/i18n';
import { messages as t } from './i18n.js';
import { OAuthTokenError } from "./token-manager.js";

/**
 * Runs a calendar tool body and turns OAuth authorization failures into a
 * readable reply (e.g. "请 master 发送 calendar auth google") instead of a crash.
 */
export async function runCalendarTool(
  operation: () => Promise<string>,
  locale?: Locale
): Promise<string> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      if (error.code === 'invalid_grant' || error.code === 'not_authorized') return t(locale, error.code === 'invalid_grant' ? 'lost' : 'notAuthorized', { provider: 'Calendar' });
      return error.message;
    }
    throw error;
  }
}
