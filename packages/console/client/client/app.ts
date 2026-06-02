import * as React from "react";

export type AddRouteInput = {
  path: string;
  name: string;
  element: React.ReactNode;
  parent?: string | null;
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

export type AddToolInput = {
  id?: string;
  name: string;
  icon?: React.ReactNode;
  parent?: string | null;
  path?: string;
};

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

type SidebarRenderer = (options: { routes: RouteTreeNode[] }) => React.ReactNode;
type ToolbarRenderer = (options: { tools: ToolTreeNode[] }) => React.ReactNode;
export type ConsoleRouteRenderer = (route: ConsoleRouteRecord) => React.ReactNode;

const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion() {
  return version;
}

let routes: ConsoleRouteRecord[] = [];
let tools: InternalToolRecord[] = [];
let sidebarRenderer: SidebarRenderer | null = null;
let toolbarRenderer: ToolbarRenderer | null = null;
let routeRenderer: ConsoleRouteRenderer | null = null;

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

function renderRouteElement(route: ConsoleRouteRecord): React.ReactNode {
  if (routeRenderer) return routeRenderer(route);
  return route.element;
}

function createConsoleApp() {
  return {
    subscribe,
    getVersion,

    defineSidebar(render: SidebarRenderer) {
      sidebarRenderer = render;
      bump();
    },

    defineToolbar(render: ToolbarRenderer) {
      toolbarRenderer = render;
      bump();
    },

    defineRouter(render: ConsoleRouteRenderer) {
      routeRenderer = render;
      bump();
    },

    addRoute(input: AddRouteInput) {
      const next = routes.filter((r) => r.path !== input.path);
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
      routes = next;
      bump();
    },

    removeRoute(path: string) {
      routes = routes.filter((r) => r.path !== path);
      bump();
    },

    addTool(input: AddToolInput): string {
      const id =
        input.id ?? `${slugId(input.name)}-${Math.random().toString(36).slice(2, 8)}`;
      if (tools.some((t) => t.id === id)) {
        throw new Error(`[zhin-console] addTool: id already exists: ${id}`);
      }
      tools = [
        ...tools,
        {
          id,
          name: input.name,
          icon: input.icon,
          parent: input.parent ?? null,
          path: input.path,
        },
      ];
      bump();
      return id;
    },

    getRouteTree(): RouteTreeNode[] {
      return buildRouteTree(routes);
    },

    getToolTree(): ToolTreeNode[] {
      return buildToolTree(tools);
    },

    _getRoutes(): readonly ConsoleRouteRecord[] {
      return routes;
    },

    _getSidebarRenderer(): SidebarRenderer | null {
      return sidebarRenderer;
    },

    _getToolbarRenderer(): ToolbarRenderer | null {
      return toolbarRenderer;
    },

    _renderRouteElement(route: ConsoleRouteRecord): React.ReactNode {
      return renderRouteElement(route);
    },
  };
}

export type ConsoleApp = ReturnType<typeof createConsoleApp>;

export const app = createConsoleApp();
