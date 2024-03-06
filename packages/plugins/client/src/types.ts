import { RouteComponent } from 'vue-router';

export interface MenuInfo {
  icon?: string;
  parentName?: string;
  children?: MenuInfo[];
  path: string;
  name: string;
}
export type MenuWithComponent = {
  component: RouteComponent;
  children?: MenuWithComponent[];
} & MenuInfo;
export type ToolInfo = {
  name?: string;
  icon?: string;
  component: RouteComponent;
};
