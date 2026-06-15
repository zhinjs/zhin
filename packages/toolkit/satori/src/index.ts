/**
 * @zhin.js/satori — HTML/CSS to SVG via official satori
 */

export { default as satori, default } from 'satori';
export { jsx, jsxs, Fragment, renderJSX, createElement, serializeChildren } from './jsx.js';
export type { JSXChild, JSXElementType, JSXProps } from './jsx.js';
export { htmlToSvg, sanitizeHtml } from './html-to-svg.js';
export type { HtmlToSvgOptions } from './html-to-svg.js';
export { escapeHtml, e, html, htmlSafe, tightHtml, wrapCardHtml } from './html-template.js';
export {
  h,
  flattenChildren,
  renderHtmlComponent,
  DEFAULT_CARD_THEME,
  LABEL_W,
  LABEL_W_HALF,
  formatCount,
  barTone,
  tint,
  Raw,
  CardCanvas,
  Card,
  Surface,
  CardHeader,
  Row,
  Col,
  Divider,
  Section,
  KvRow,
  KvTable,
  UsageBar,
  MetricBlock,
  DualSection,
  Badge,
  StatChip,
  BarRow,
  BarChart,
  RadarChart,
  Sparkline,
  TopicItem,
  QuoteCard,
  ProfileRow,
  EmptyState,
  composeCard,
} from './html-components.js';
export type {
  HtmlChild,
  HtmlChildNode,
  HtmlComponent,
  RawProps,
  CardCanvasProps,
  CardProps,
  SurfaceProps,
  CardHeaderProps,
  RowProps,
  ColProps,
  DividerProps,
  SectionProps,
  KvRowProps,
  KvTableProps,
  UsageBarProps,
  MetricBlockProps,
  DualSectionProps,
  BadgeProps,
  StatChipProps,
  BarRowProps,
  BarChartProps,
  RadarChartProps,
  SparklineProps,
  TopicItemProps,
  QuoteCardProps,
  ProfileRowProps,
  EmptyStateProps,
} from './html-components.js';

export type { BuiltinFont, Weight, FontStyle } from './fonts.js';
export {
  getPoppinsRegular,
  getPoppinsBold,
  getNotoSansCJK,
  getNotoSansSC,
  getNotoSansJP,
  getNotoSansKR,
  getNotoColorEmoji,
  getAllBuiltinFonts,
  getDefaultFonts,
  getExtendedFonts,
  getCJKFonts,
  getCompleteFonts,
} from './fonts.js';
