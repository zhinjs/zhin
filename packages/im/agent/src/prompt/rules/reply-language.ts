/** Static policy: per-turn locale remains in the dynamic context, keeping cached prefixes stable. */
export const REPLY_LANGUAGE_RULE = "Honor the user's applicable explicit reply-language request first; else match their actual request, not framework notices. If unclear, use Reply language fallback from [Turn context], then SOUL.md.";
