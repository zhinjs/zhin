import {
  usePlugin,
  Time,
  MessageCommand,
  MessageElement,
} from "zhin.js";
import path from "node:path";
import * as os from "node:os";
import { writeHeapSnapshot } from "node:v8";

declare module "@zhin.js/core" {
  interface Models {
    test_model: {
      name: string;
      age: number;
      info: object;
    };
  }
}
const {addCommand,addComponent,root,useContext}=usePlugin()
// 全局内存历史记录
declare global {
  var _memoryHistory: Array<{ time: number; rss: number; heapUsed: number }> | undefined;
}
const isBun=typeof Bun!=='undefined'
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
addCommand(
  new MessageCommand("zt")
    .desc("查看系统状态", "显示操作系统、CPU、内存、运行时和框架的完整状态信息")
    .usage("zt")
    .examples("zt")
    .action(() => {
    // ============================================
    // 系统信息
    // ============================================
    
    // 操作系统
    const osType = os.type();
    const osRelease = os.release();
    const osArch = os.arch();
    const platform = os.platform();
    
    // 系统内存
    const totalmem = os.totalmem();
    const freemem = os.freemem();
    const usedSystemMem = totalmem - freemem;
    
    // 进程真实内存使用（heapUsed 是 V8 堆内存，rss 是真实物理内存）
    const memUsage = process.memoryUsage();
    const processRealMem = memUsage.rss;           // 真实物理内存（Resident Set Size）
    const processHeapTotal = memUsage.heapTotal;   // V8 堆总大小
    const processHeapUsed = memUsage.heapUsed;     // V8 堆已使用
    const processExternal = memUsage.external;     // C++ 对象内存
    const memUsagePercent = ((usedSystemMem / totalmem) * 100).toFixed(2);
    
    const processMemPercent = ((processRealMem / totalmem) * 100).toFixed(2);
    const isHighMemoryPressure = parseFloat(processMemPercent) > 80;
    
    // 系统运行时长（秒）
    const systemUptime = os.uptime();
    
    // ============================================
    // 进程信息
    // ============================================
    
    // 运行环境
    const runtime = isBun 
      ? `Bun ${Bun.version}` 
      : `Node.js ${process.version}`;
    
    // 进程运行时长（秒）
    const processUptime = process.uptime();
    
    
    // （已在上面计算）
    
    // CPU 信息
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;
    
    // ============================================
    // 格式化输出
    // ============================================
    
    return [
      "╔═══════════ 系统状态 ═══════════╗",
      "",
      "【操作系统】",
      `  系统：${osType} ${osRelease}`,
      `  平台：${platform} (${osArch})`,
      `  开机时长：${Time.formatTime(systemUptime * 1000)}`,
      "",
      "【CPU 信息】",
      `  型号：${cpuModel}`,
      `  核心数：${cpuCores} 核`,
      "",
      "【系统内存】",
      `  总内存：${formatMemoSize(totalmem)}`,
      `  已使用：${formatMemoSize(usedSystemMem)} (${memUsagePercent}%)`,
      `  可用：${formatMemoSize(freemem)}`,
      "",
      "【运行环境】",
      `  运行时：${runtime}`,
      `  架构：${process.arch}`,
      `  PID：${process.pid}`,
      "",
      "【进程状态】",
      `  运行时长：${Time.formatTime(processUptime * 1000)}`,
      `  物理内存：${formatMemoSize(processRealMem)} (${processMemPercent}%) ${isHighMemoryPressure ? '⚠️ 高' : '✅ 正常'}`,
      `  堆内存：${formatMemoSize(processHeapUsed)} / ${formatMemoSize(processHeapTotal)}`,
      `  外部内存：${formatMemoSize(processExternal)}`,
      "",
      "╠═══════════ 框架状态 ═══════════╣",
      "",
      "【框架信息】",
      `  适配器：${root.children.length} 个`,
      `  插件：${root.children.length} 个`,
      "",
      "",
      "╚════════════════════════════════╝",
    ].join("\n");
  })
);
// ============================================
// 内存分析命令
// ============================================
addCommand(
  new MessageCommand("mem")
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
      `  │  占总内存：${heapOfTotal}%`,
      `  │`,
      `  ├─ 外部内存 (C++)`,
      `  │  大小：${formatMemoSize(external)}`,
      `  │  占总内存：${externalOfTotal}%`,
      `  │  说明：Buffer、TypedArray 等`,
      `  │`,
      `  ├─ ArrayBuffer 内存`,
      `  │  大小：${formatMemoSize(arrayBuffers)}`,
      `  │  占总内存：${arrayBuffersOfTotal}%`,
      `  │  说明：ArrayBuffer、SharedArrayBuffer`,
      `  │`,
      `  └─ 其他内存 (栈、代码等)`,
      `     大小：${formatMemoSize(nonHeapMemory)}`,
      `     占总内存：${nonHeapPercent}%`,
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
  const heapUsagePercent = (heapUsed / heapTotal) * 100;
  if (heapUsagePercent < 50) {
    analysis.push("  堆使用率：✅ 健康 (<50%) - 有足够增长空间");
  } else if (heapUsagePercent < 75) {
    analysis.push("  堆使用率：⚠️  中等 (50-75%) - 建议监控");
  } else {
    analysis.push("  堆使用率：❌ 偏高 (>75%) - 可能需要 GC");
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
  
  // 142MB 是比较正常的
  if (rss < 150 * 1024 * 1024) {
    tips.push("  ✅ 当前内存使用良好，无需特别优化");
  } else if (rss < 200 * 1024 * 1024) {
    tips.push("  💡 内存使用正常，可考虑以下优化：");
    tips.push("     • 检查是否有大型对象常驻内存");
    tips.push("     • 定期清理不用的缓存");
  } else {
    tips.push("  ⚠️  建议优化内存使用：");
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


addCommand(new MessageCommand("我才是[...content:text]")
.action(async (m, { params }) => {
  return `好好好，你是${params.content.join(" ").replace(/[你|我]/g, (match:string) => {
    return match === "你" ? "我" : "你"
  })}`;
}));
addComponent(async function foo(
  props: { face: number },
) {
  return "这是父组件" + props.face;
});
const randomUUID = () => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
console.log("测试插件加载完成，唯一标识：" + randomUUID());

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
    const result = await model.select();
    console.log(result);
  }
});