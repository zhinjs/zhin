import {
  usePlugin,
  useLogger,
  defineModel,
  onDatabaseReady,
  segment,
  defineSchema,
  Schema,
} from "zhin.js";
import type { SendOptions } from "zhin.js";
import {
  getEnabledWords,
  createSensitiveWordRegex,
} from "./sensitive-words.js";

const logger = useLogger();
const plugin = usePlugin();
const schema = defineSchema(
  Schema.object({
    political: Schema.boolean("political")
      .default(true)
      .description("启用政治类敏感词过滤"),
    violence: Schema.boolean("violence")
      .default(true)
      .description("启用暴力类敏感词过滤"),
    porn: Schema.boolean("porn")
      .default(true)
      .description("启用色情类敏感词过滤"),
    prohibited: Schema.boolean("prohibited")
      .default(true)
      .description("启用禁用类敏感词过滤"),
    fraud: Schema.boolean("fraud")
      .default(true)
      .description("启用诈骗类敏感词过滤"),
    illegal: Schema.boolean("illegal")
      .default(true)
      .description("启用违法类敏感词过滤"),
    custom: Schema.list(Schema.string()).default([]).description("自定义敏感词"),
    replacement: Schema.string("replacement")
      .default("*")
      .description("替换字符"),
    block: Schema.boolean("block").default(false).description("是否拦截消息"),
  }).default({
    political: true,
    violence: true, 
    porn: true,
    prohibited: true,
    fraud: true,
    illegal: true,
    custom: [],
    replacement: "*",
    block: false,
  })
);
// 插件配置
const config = schema(plugin.config, "sensitive-filter");

/**
 * 检测文本中的敏感词
 */
function detectSensitiveWords(text: string, regex: RegExp): string[] {
  const matches = text.match(regex);
  return matches ? [...new Set(matches)] : [];
}

/**
 * 替换文本中的敏感词
 */
function replaceSensitiveWords(
  text: string,
  regex: RegExp,
  replacement: string
): string {
  return text.replace(regex, (match) => replacement.repeat(match.length));
}

/**
 * 过滤消息内容
 */
function filterContent(
  content: any,
  regex: RegExp,
  replacement: string
): { filtered: any; detected: string[] } {
  let detected: string[] = [];

  // 处理字符串内容
  if (typeof content === "string") {
    detected = detectSensitiveWords(content, regex);
    const filtered = replaceSensitiveWords(content, regex, replacement);
    return { filtered, detected };
  }

  // 处理消息段数组
  if (Array.isArray(content)) {
    const filteredContent: any[] = [];

    for (const element of content) {
      if (typeof element === "string") {
        const words = detectSensitiveWords(element, regex);
        detected.push(...words);
        filteredContent.push(
          replaceSensitiveWords(element, regex, replacement)
        );
      } else if (element && typeof element === "object") {
        // 处理消息段对象
        if (element.type === "text" && element.data?.text) {
          const words = detectSensitiveWords(element.data.text, regex);
          detected.push(...words);
          filteredContent.push({
            ...element,
            data: {
              ...element.data,
              text: replaceSensitiveWords(
                element.data.text,
                regex,
                replacement
              ),
            },
          });
        } else {
          // 其他类型的消息段不处理
          filteredContent.push(element);
        }
      } else {
        filteredContent.push(element);
      }
    }

    return { filtered: filteredContent, detected: [...new Set(detected)] };
  }

  return { filtered: content, detected: [] };
}

// 初始化敏感词过滤
const sensitiveWords = getEnabledWords(config);
const sensitiveRegex = createSensitiveWordRegex(sensitiveWords);
plugin.beforeSend(async (options: SendOptions) => {
    
    const { content } = options;

    // 如果内容为空，直接返回
    if (!content) return options;

    // 转换内容为字符串用于检测
    const contentStr =
      typeof content === "string" ? content : segment.toString(content as any);

    // 检测敏感词
    const detectedWords = detectSensitiveWords(contentStr, sensitiveRegex);

    // 如果没有检测到敏感词，直接返回
    if (detectedWords.length === 0) {
      return options;
    }

    logger.warn(`检测到敏感词: ${detectedWords.join(", ")}`);

    // 如果配置为拦截模式，返回警告消息
    if (config.block) {
      return {
        ...options,
        content: `⚠️ 消息包含敏感词，已被拦截。`,
      };
    }

    // 替换模式：过滤敏感词
    const { filtered, detected } = filterContent(
      content,
      sensitiveRegex,
      config.replacement || "*"
    );

    const filteredStr =
      typeof filtered === "string"
        ? filtered
        : segment.toString(filtered as any);
    return {
      ...options,
      content: filtered as any,
    };
  });

  logger.info("敏感词过滤功能已启用");
logger.info(`敏感词过滤插件已加载，共 ${sensitiveWords.length} 个敏感词`);
