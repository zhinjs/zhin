/**
 * 侧边栏菜单字符串 icon → lucide 组件（勿使用 import * from 'lucide-react'，会与 Farm+HMR+pnpm 深层路径冲突）。
 */
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Brain,
  Clock,
  Database,
  FileText,
  FolderOpen,
  Globe,
  Home,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Puzzle,
  Server,
  Settings,
  Shield,
  Store,
  Terminal,
  Users,
  Wrench,
  Circle,
} from "lucide-react";

/** 内置 registerBuiltinShell 与各插件常用名；未知名称回退 Circle */
const SIDEBAR_LUCIDE_BY_NAME: Record<string, LucideIcon> = {
  Home,
  Bot,
  FileText,
  Clock,
  Package,
  Store,
  Settings,
  KeyRound,
  FolderOpen,
  Database,
  LayoutDashboard,
  LayoutGrid,
  Puzzle,
  Users,
  Terminal,
  Server,
  Activity,
  BarChart3,
  Bell,
  Brain,
  Globe,
  Shield,
  Wrench,
};

export function getSidebarLucideIcon(name: string): LucideIcon {
  return SIDEBAR_LUCIDE_BY_NAME[name] ?? Circle;
}
