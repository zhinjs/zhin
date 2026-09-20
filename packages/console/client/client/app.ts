import * as React from "react";
import type {
  PluginAddRouteInput,
  PluginAddToolInput,
} from '@zhin.js/contract';

export type AddRouteInput = PluginAddRouteInput;
export type AddToolInput = PluginAddToolInput;

export type ConsoleRouteRecord = {
  path: string;
  name: string;
  element: React.ReactNode;
  parent: string | null;
  icon?: React.ReactNode | string;
  requiredPermissions?: string[];
  requiredRoles?: string[];
  meta?: {
    hideInMenu?: boolean;
    order?: number;
    group?: string;
    fullWidth?: boolean;
  };
};

export type InternalToolRecord = {
  id: string;
  name: string;
  icon?: React.ReactNode;
  parent: string | null;
  path?: string;
};

export type RouteTreeNode = ConsoleRouteRecord & { children: RouteTreeNode[] };
export type ToolTreeNode = InternalToolRecord & { children: ToolTreeNode[] };

export type SidebarRenderer = (options: { routes: RouteTreeNode[] }) => React.ReactNode;
export type ToolbarRenderer = (options: { tools: ToolTreeNode[] }) => React.ReactNode;
export type ConsoleRouteRenderer = (route: ConsoleRouteRecord) => React.ReactNode;

function slugId(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "tool"
  );
}

function buildRouteTree(flatRoutes: ConsoleRouteRecord[]): RouteTreeNode[] {
  const nodes: RouteTreeNode[] = flatRoutes.map((r) => ({ ...r, children: [] }));
  const roots: RouteTreeNode[] = [];

  for (const node of nodes) {
    if (!node.parent) {
      roots.push(node);
    } else {
      const parent = nodes.find((n) => n.path === node.parent);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  const sortFn = (a: RouteTreeNode, b: RouteTreeNode) =>
    (a.meta?.order ?? 999) - (b.meta?.order ?? 999);
  roots.sort(sortFn);
  for (const n of nodes) n.children.sort(sortFn);

  return roots;
}

function buildToolTree(flatTools: InternalToolRecord[]): ToolTreeNode[] {
  const nodes: ToolTreeNode[] = flatTools.map((t) => ({ ...t, children: [] }));
  const roots: ToolTreeNode[] = [];

  for (const node of nodes) {
    if (!node.parent) {
      roots.push(node);
    } else {
      const parent = nodes.find((n) => n.id === node.parent);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }
  return roots;
}
/** Owner-scoped registry for one mounted Remote Console application. */
export class ConsoleApp {
  readonly #listeners = new Set<() => void>();
  #version = 0;
  #routes: ConsoleRouteRecord[] = [];
  #tools: InternalToolRecord[] = [];
  #sidebarRenderer: SidebarRenderer | null = null;
  #toolbarRenderer: ToolbarRenderer | null = null;
  #routeRenderer: ConsoleRouteRenderer | null = null;
  #disposed = false;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#assertActive();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getVersion = (): number => this.#version;

  defineSidebar(render: SidebarRenderer): void {
    this.#assertActive();
    this.#sidebarRenderer = render;
    this.#bump();
  }

  defineToolbar(render: ToolbarRenderer): void {
    this.#assertActive();
    this.#toolbarRenderer = render;
    this.#bump();
  }

  defineRouter(render: ConsoleRouteRenderer): void {
    this.#assertActive();
    this.#routeRenderer = render;
    this.#bump();
  }

  addRoute(input: AddRouteInput): void {
    this.#assertActive();
    const next = this.#routes.filter((route) => route.path !== input.path);
    next.push({
      path: input.path,
      name: input.name,
      element: input.element,
      parent: input.parent ?? null,
      icon: input.icon,
      requiredPermissions: input.requiredPermissions,
      requiredRoles: input.requiredRoles,
      meta: input.meta,
    });
    this.#routes = next;
    this.#bump();
  }

  removeRoute(path: string): void {
    this.#assertActive();
    this.#routes = this.#routes.filter((route) => route.path !== path);
    this.#bump();
  }

  addTool(input: AddToolInput): string {
    this.#assertActive();
    const id = input.id ?? `${slugId(input.name)}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.#tools.some((tool) => tool.id === id)) {
      throw new Error(`[zhin-console] addTool: id already exists: ${id}`);
    }
    this.#tools = [
      ...this.#tools,
      {
        id,
        name: input.name,
        icon: input.icon,
        parent: input.parent ?? null,
        path: input.path,
      },
    ];
    this.#bump();
    return id;
  }

  getRouteTree(): RouteTreeNode[] {
    return buildRouteTree(this.#routes);
  }

  getToolTree(): ToolTreeNode[] {
    return buildToolTree(this.#tools);
  }

  getRoutes(): readonly ConsoleRouteRecord[] {
    return this.#routes;
  }

  getSidebarRenderer(): SidebarRenderer | null {
    return this.#sidebarRenderer;
  }

  getToolbarRenderer(): ToolbarRenderer | null {
    return this.#toolbarRenderer;
  }

  renderRouteElement(route: ConsoleRouteRecord): React.ReactNode {
    return this.#routeRenderer ? this.#routeRenderer(route) : route.element;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
    this.#routes = [];
    this.#tools = [];
    this.#sidebarRenderer = null;
    this.#toolbarRenderer = null;
    this.#routeRenderer = null;
  }

  #bump(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('ConsoleApp has been disposed');
  }
}

export function createConsoleApp(): ConsoleApp {
  return new ConsoleApp();
}
