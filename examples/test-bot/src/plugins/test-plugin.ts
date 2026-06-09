import {
  usePlugin,
  Time,
  MessageCommand,
  MessageElement,
  Cron,
} from "zhin.js";
import path from "node:path";
import * as os from "node:os";
import { writeHeapSnapshot } from "node:v8";
declare module "zhin.js" {
  interface Models {
    test_model: {
      name: string;
      age: number;
      info: object;
    };
  }
}
const plugin = usePlugin();
const { addCommand, addComponent, useContext } = plugin;
// 全局内存历史记录
declare global {
  var _memoryHistory: Array<{ time: number; rss: number; heapUsed: number }> | undefined;
}
function formatMemoSize(size: number) {
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  while (size > 1024) {
    size = size / 1024;
    sizes.shift();
  }
  return `${size.toFixed(2)}${sizes[0]}`;
}
addCommand(
  new MessageCommand("send").action(
    (_, result) => result.remaining as MessageElement[]
  )
);
// ============================================
// 内存分析命令
// ============================================
addCommand(
  new MessageCommand("mem-simple")
    .desc("查看内存详情", "显示进程的详细内存使用情况，包括 RSS、堆内存、外部内存等")
    .usage("mem")
    .examples("mem")
    .action(() => {
      const memUsage = process.memoryUsage();

      // 基础内存信息
      const rss = memUsage.rss;                    // 真实物理内存（Resident Set Size）
      const heapTotal = memUsage.heapTotal;        // V8 堆总大小
      const heapUsed = memUsage.heapUsed;          // V8 堆已使用
      const external = memUsage.external;          // C++ 对象内存
      const arrayBuffers = memUsage.arrayBuffers;  // ArrayBuffer 和 SharedArrayBuffer

      // 计算各部分占比
      const heapPercent = ((heapUsed / heapTotal) * 100).toFixed(2);
      const heapOfTotal = ((heapUsed / rss) * 100).toFixed(2);
      const externalOfTotal = ((external / rss) * 100).toFixed(2);
      const arrayBuffersOfTotal = ((arrayBuffers / rss) * 100).toFixed(2);

      // 计算未在堆中的内存（栈、代码、其他）
      const nonHeapMemory = rss - heapUsed - external - arrayBuffers;
      const nonHeapPercent = ((nonHeapMemory / rss) * 100).toFixed(2);

      // 堆内存碎片率
      const heapFragmentation = heapTotal - heapUsed;
      const fragmentationPercent = ((heapFragmentation / heapTotal) * 100).toFixed(2);

      // 内存增长趋势（需要多次采样）
      const memoryTrend = global._memoryHistory || [];
      memoryTrend.push({ time: Date.now(), rss, heapUsed });
      if (memoryTrend.length > 10) memoryTrend.shift();
      global._memoryHistory = memoryTrend;

      let trendInfo = "需要多次调用才能显示趋势";
      if (memoryTrend.length >= 2) {
        const first = memoryTrend[0];
        const last = memoryTrend[memoryTrend.length - 1];
        const rssDiff = last.rss - first.rss;
        const heapDiff = last.heapUsed - first.heapUsed;
        const timeDiff = (last.time - first.time) / 1000; // 秒

        const rssRate = formatMemoSize(Math.abs(rssDiff / timeDiff)) + '/s';
        const heapRate = formatMemoSize(Math.abs(heapDiff / timeDiff)) + '/s';

        trendInfo = rssDiff > 0
          ? `📈 增长中 (物理: +${rssRate}, 堆: +${heapRate})`
          : rssDiff < 0
            ? `📉 下降中 (物理: -${rssRate}, 堆: -${heapRate})`
            : `➡️  稳定`;
      }

      // 系统内存对比
      const totalmem = os.totalmem();
      const processPercent = ((rss / totalmem) * 100).toFixed(4);

      // 计算可见内存和不可见内存
      const visibleMemory = heapTotal + external + arrayBuffers;
      const hiddenMemory = rss - visibleMemory;
      const hiddenPercent = hiddenMemory > 0 ? ((hiddenMemory / rss) * 100).toFixed(2) : '0.00';
      const heapPercentOfRSS = ((heapTotal / rss) * 100).toFixed(2);

      return [
        "╔═══════════ 内存详细分析 ═══════════╗",
        "",
        "【内存总览】",
        `  物理内存 (RSS)：${formatMemoSize(rss)}`,
        `  占系统内存：${processPercent}%`,
        `  趋势：${trendInfo}`,
        "",
        "【内存组成】",
        `  ┌─ V8 堆内存`,
        `  │  已使用：${formatMemoSize(heapUsed)} (${heapPercent}%)`,
        `  │  已分配：${formatMemoSize(heapTotal)}`,
        `  │  碎片化：${formatMemoSize(heapFragmentation)} (${fragmentationPercent}%)`,
        `  │  占 RSS：${heapPercentOfRSS}%`,
        `  │  ⚠️  注意：堆内存不会自动缩小，即使 RSS 降低`,
        `  │`,
        `  ├─ 外部内存 (C++)`,
        `  │  大小：${formatMemoSize(external)}`,
        `  │  占 RSS：${externalOfTotal}%`,
        `  │  说明：Buffer、TypedArray 等`,
        `  │`,
        `  ├─ ArrayBuffer 内存`,
        `  │  大小：${formatMemoSize(arrayBuffers)}`,
        `  │  占 RSS：${arrayBuffersOfTotal}%`,
        `  │  说明：ArrayBuffer、SharedArrayBuffer`,
        `  │`,
        `  └─ 其他内存 (代码段、栈、共享库等)`,
        `     大小：${formatMemoSize(nonHeapMemory)}`,
        `     占 RSS：${nonHeapPercent}%`,
        `     说明：Node.js 运行时、共享库、内存映射文件等`,
        "",
        "【内存差异说明】",
        `  可见内存 (堆+外部+ArrayBuffer)：${formatMemoSize(visibleMemory)}`,
        `  不可见内存 (代码+栈+共享库)：${formatMemoSize(hiddenMemory)} (${hiddenPercent}%)`,
        `  物理内存 (RSS)：${formatMemoSize(rss)}`,
        "",
        `💡 为什么物理内存 (${formatMemoSize(rss)}) 可能比堆内存 (${formatMemoSize(heapTotal)}) 小？`,
        "   • macOS 内存压缩：不活跃内存被压缩，RSS 降低",
        "   • 内存交换：不活跃内存被交换到磁盘，RSS 降低",
        "   • 共享库优化：共享库可能被其他进程共享，不重复计算",
        "   • 堆内存不会自动缩小：V8 预分配的堆内存不会释放回操作系统",
        "",
        "✅ 这是正常的！只要堆内存稳定（不持续增长），就没有内存泄漏。",
        "",
        "【内存占用分析】",
        ...analyzeMemoryUsage(rss, heapUsed, heapTotal, external),
        "",
        "【优化建议】",
        ...getMemoryOptimizationTips(rss, heapUsed, heapTotal, fragmentationPercent),
        "",
        "╚═════════════════════════════════════╝",
        "",
        "💡 提示：多次调用此命令可查看内存增长趋势"
      ].join("\n");
    })
);

// 内存使用分析函数
function analyzeMemoryUsage(rss: number, heapUsed: number, heapTotal: number, external: number) {
  const analysis = [];

  // 分析物理内存
  if (rss < 50 * 1024 * 1024) {
    analysis.push("  物理内存：✅ 极低 (<50MB) - 非常理想");
  } else if (rss < 100 * 1024 * 1024) {
    analysis.push("  物理内存：✅ 较低 (50-100MB) - 良好");
  } else if (rss < 200 * 1024 * 1024) {
    analysis.push("  物理内存：⚠️  中等 (100-200MB) - 可接受");
  } else if (rss < 500 * 1024 * 1024) {
    analysis.push("  物理内存：⚠️  较高 (200-500MB) - 需关注");
  } else {
    analysis.push("  物理内存：❌ 很高 (>500MB) - 需要优化");
  }

  // 分析堆使用率
  // V8 的堆使用率在 80-95% 是正常的，V8 会动态调整堆大小
  const heapUsagePercent = (heapUsed / heapTotal) * 100;
  if (heapUsagePercent < 50) {
    analysis.push("  堆使用率：✅ 健康 (<50%) - 有足够增长空间");
  } else if (heapUsagePercent < 80) {
    analysis.push("  堆使用率：✅ 正常 (50-80%) - V8 会自动管理");
  } else if (heapUsagePercent < 95) {
    analysis.push("  堆使用率：✅ 正常 (80-95%) - V8 会动态扩展堆");
  } else {
    analysis.push("  堆使用率：⚠️  较高 (>95%) - V8 即将扩展堆或触发 GC");
  }

  // 分析外部内存
  const externalPercent = (external / rss) * 100;
  if (externalPercent > 30) {
    analysis.push("  外部内存：⚠️  占比较高 (>30%) - 检查 Buffer 使用");
  }

  return analysis;
}

// 内存优化建议函数
function getMemoryOptimizationTips(rss: number, heapUsed: number, heapTotal: number, fragmentationPercent: string) {
  const tips = [];

  // 内存使用评估（基于实际 Bot 框架对比）
  // Discord.js: ~150-300MB, Koishi: ~100-200MB, 你的框架: ~50-100MB (优秀！)
  if (rss < 100 * 1024 * 1024) {
    tips.push("  ✅ 内存使用优秀 (<100MB) - 比大多数 Bot 框架更轻量");
    tips.push("     • Discord.js 通常需要 150-300MB");
    tips.push("     • Koishi 通常需要 100-200MB");
    tips.push("     • 你的应用仅需 " + (rss / 1024 / 1024).toFixed(1) + "MB，非常优秀！");
  } else if (rss < 200 * 1024 * 1024) {
    tips.push("  ✅ 内存使用良好 (100-200MB) - 属于正常范围");
    tips.push("     • 与主流 Bot 框架相当");
  } else if (rss < 500 * 1024 * 1024) {
    tips.push("  💡 内存使用正常 (200-500MB) - 可考虑优化：");
    tips.push("     • 检查是否有大型对象常驻内存");
    tips.push("     • 定期清理不用的缓存");
  } else {
    tips.push("  ⚠️  建议优化内存使用 (>500MB)：");
    tips.push("     • 使用 WeakMap/WeakSet 避免内存泄漏");
    tips.push("     • 及时释放大型 Buffer");
    tips.push("     • 考虑使用流式处理大数据");
    tips.push("     • 定期触发 GC (开发环境)");
  }

  // 堆碎片化建议
  if (parseFloat(fragmentationPercent) > 50) {
    tips.push("  💡 堆碎片化较高，考虑手动触发 GC");
  }

  return tips;
}

// ============================================
// 堆快照命令 - 生成内存快照文件
// ============================================
addCommand(
  new MessageCommand("heap")
    .desc("生成堆快照", "生成 V8 堆内存快照文件，用于内存分析")
    .usage("heap")
    .examples("heap")
    .action(() => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `heap-${timestamp}.heapsnapshot`;
        const filepath = path.resolve(process.cwd(), filename);

        // 生成堆快照
        writeHeapSnapshot(filepath);

        return [
          "✅ 堆快照已生成！",
          "",
          `文件：${filename}`,
          `路径：${filepath}`,
          "",
          "📖 使用方法：",
          "1. 打开 Chrome DevTools",
          "2. 进入 Memory 标签",
          "3. 点击 'Load' 加载 .heapsnapshot 文件",
          "4. 查看内存分配详情",
          "",
          "💡 提示：",
          "• 可以对比多个快照找出内存泄漏",
          "• Statistics 视图显示类型分布",
          "• Containment 视图显示对象引用",
          "• Summary 视图按类型汇总"
        ].join("\n");
      } catch (error) {
        return `❌ 生成快照失败: ${error}`;
      }
    })
);

// ============================================
// 自动清理功能测试
// ============================================

// 存储动态添加的 dispose 函数
const dynamicDisposes: (() => void)[] = [];


addCommand(
  new MessageCommand("test-component")
    .desc("测试动态组件", "添加一个临时组件")
    .usage("test-component [name]")
    .action((_, result) => {
      const name = (result.remaining as any[])?.[0]?.data?.text || `comp-${Date.now()}`;

      // 动态添加一个组件
      plugin.addComponent(async function dynamicComp(props: { text: string }) {
        return `动态组件[${name}]: ${props.text}`;
      });

      const componentService = plugin.inject('component');

      return [
        `✅ 已添加组件: dynamicComp`,
        "",
        "💡 热重载插件后，此组件会自动移除"
      ].join("\n");
    })
);

addCommand(
  new MessageCommand("cron-list")
    .desc("查看定时任务状态", "显示所有定时任务的状态")
    .usage("test-cron-list")
    .action(() => {
      const crons = plugin.inject('cron');

      if (!crons || crons.items.length === 0) {
        return "📋 暂无定时任务";
      }

      const lines = [
        "╔═══════════ 定时任务状态 ═══════════╗",
        "",
        `📋 总数: ${crons.items.length}`,
        ""
      ];

      crons.items.forEach((cron: any, index: number) => {
        lines.push(`[${cron.id}] ${cron.cronExpression || cron._cronExpression}`);
        lines.push(`    状态: ${cron.running ? '🏃 运行中' : '⏸️ 已停止'}`);
        if (cron.running) {
          try {
            lines.push(`    下次执行: ${cron.getNextExecutionTime().toLocaleString()}`);
          } catch { }
        }
        lines.push("");
      });

      lines.push("╚════════════════════════════════════╝");

      return lines.join("\n");
    })
);


useContext("database", async (db) => {
  db.define("test_model", {
    name: { type: "text", nullable: false },
    age: { type: "integer", default: 0 },
    info: { type: "json" },
  });
  const model = db.models.get("test_model");
  // await model.create({
  //   name:'张三',
  //   age:20,
  //   info:{}
  // });
  // await model.delete({name:'张三'});
  if (model) {
    const rows = await model.select();
    if (rows.length > 0) {
      plugin.logger.debug(`test_model rows: ${rows.length}`);
    }
  }
});

try {
  const clientEntry = path.resolve(process.cwd(), "client/index.tsx");
  useContext("web", (pageManager) => {
    pageManager.addEntry({
      id: "test-plugin",
      development: clientEntry,
      production: clientEntry,
      meta: { name: "Test Plugin" },
    });
  });
} catch {}