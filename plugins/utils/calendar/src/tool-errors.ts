import { OAuthTokenError } from "./token-manager.js";

/**
 * Runs a calendar tool body and turns OAuth authorization failures into a
 * readable reply (e.g. "请 master 发送 calendar auth google") instead of a crash.
 */
export async function runCalendarTool(
  operation: () => Promise<string>
): Promise<string> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      return error.message;
    }
    throw error;
  }
}
