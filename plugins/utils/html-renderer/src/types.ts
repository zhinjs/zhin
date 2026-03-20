/**
 * HTML 渲染器类型定义
 */

/**
 * 输出格式
 */
export type OutputFormat = 'svg' | 'png';

/**
 * 字体配置
 */
export interface FontConfig {
  /** 字体名称 */
  name: string;
  /** 字体数据 (ArrayBuffer 或 Buffer) */
  data: ArrayBuffer | Buffer;
  /** 字体粗细 */
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  /** 字体样式 */
  style?: 'normal' | 'italic';
}

/**
 * 渲染选项
 */
export interface RenderOptions {
  /** 输出宽度（像素） */
  width?: number;
  /** 输出高度（像素，如果不指定则自动计算） */
  height?: number;
  /** 输出格式 */
  format?: OutputFormat;
  /** 背景颜色 */
  backgroundColor?: string;
  /** 自定义字体 */
  fonts?: FontConfig[];
  /** 是否启用表情符号渲染 */
  enableEmoji?: boolean;
  /** 缩放比例（用于高清渲染） */
  scale?: number;
}

/**
 * 渲染结果
 */
export interface RenderResult {
  /** 输出数据 */
  data: Buffer | string;
  /** 输出格式 */
  format: OutputFormat;
  /** 实际宽度 */
  width: number;
  /** 实际高度 */
  height: number;
  /** MIME 类型 */
  mimeType: string;
}

/**
 * 纯文本在发出前自动渲染为 PNG（通过框架 `before.sendMessage`）。
 * 设为 `true` 等价于 `{ enabled: true }`。
 */
export interface HtmlRendererAiTextAsImageConfig {
  /** 是否启用（对象形式下缺省为 true；可显式设为 false 关闭） */
  enabled?: boolean;
  /**
   * 仅在这些 adapter context 名上生效（与 `SendOptions.context` 一致，如 onebot、qq）。
   * 不填或空数组表示全部平台。
   */
  onlyAdapters?: string[];
  /** 低于该字符数不转图，仍发原文 */
  minLength?: number;
  /** 超过则不转图（避免超大画布）；0 或不填表示不限制 */
  maxLength?: number;
  /** 字符串里出现疑似富媒体标签 / CQ 码时跳过（默认 true） */
  skipIfRich?: boolean;
  /** 画布宽度（像素） */
  width?: number;
  height?: number;
  backgroundColor?: string;
  /** 正文字号 px */
  fontSize?: number;
  /** 正文颜色 */
  color?: string;
  /** 内层文字区域 padding（像素），由外层 wrap 控制观感时可与 width 配合 */
  padding?: number;
  /** PNG 缩放（高清） */
  scale?: number;
  /** 随图发送的文件名提示 */
  fileName?: string;
}

/**
 * 插件配置
 */
export interface HtmlRendererConfig {
  /** 默认宽度 */
  defaultWidth?: number;
  /** 默认字体 */
  defaultFonts?: FontConfig[];
  /** 默认背景颜色 */
  defaultBackgroundColor?: string;
  /** 是否缓存字体 */
  cacheFonts?: boolean;
  /** 字体 URL（用于自动加载） */
  fontUrls?: string[];
  /**
   * 输出方式：将「仅纯文本」的发送内容在送达用户前转为图片。
   * 适用于希望 AI/机器人长文以卡片图展示的场景；富媒体消息会自动跳过。
   */
  aiTextAsImage?: boolean | HtmlRendererAiTextAsImageConfig;
}

/**
 * 渲染服务接口
 */
export interface HtmlRendererService {
  /** 渲染 HTML 字符串为图片 */
  render(html: string, options?: RenderOptions): Promise<RenderResult>;
  
  /** 渲染 JSX 元素为图片 */
  renderJsx(element: JSX.Element, options?: RenderOptions): Promise<RenderResult>;
  
  /** 注册字体 */
  registerFont(font: FontConfig): void;
  
  /** 获取已注册的字体 */
  getFonts(): FontConfig[];
  
  /** 清空字体缓存 */
  clearFonts(): void;
}

/**
 * 模板渲染上下文
 */
export interface TemplateContext {
  /** 模板数据 */
  data: Record<string, any>;
  /** 渲染选项 */
  options?: RenderOptions;
}
