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
