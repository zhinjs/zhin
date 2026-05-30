/**
 * @zhin.js/plugin-group-suite
 *
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-group-suite"
 * inbox:
 *   enabled: true
 * groupSuite:
 *   noticeAdapters: [icqq]
 *   autoAnalysisEnabled: true
 * ```
 */
import { formatCompact, usePlugin } from "zhin.js";
import { groupSuiteSchema } from "./config.js";
import { registerAdmin } from "./admin.js";
import { registerCheckin } from "./checkin.js";
import { registerDailyAnalysis } from "./daily-analysis.js";
import { registerStats } from "./stats.js";
import { registerTeach } from "./teach.js";

const plugin = usePlugin();
const { logger, declareConfig } = plugin;

const cfg = declareConfig("groupSuite", groupSuiteSchema);

registerAdmin(plugin, cfg);
registerCheckin(plugin, cfg);
registerStats(plugin, cfg);
registerDailyAnalysis(plugin, cfg);
registerTeach(plugin, cfg);

logger.info(formatCompact({ op: "group_suite_load" }));
