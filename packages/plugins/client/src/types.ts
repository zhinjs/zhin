import { RouteComponent } from 'vue-router';

export interface MenuInfo {
  icon?: string;
  parentName?: string;
  path: string;
  name: string;
}
export type MenuWithComponent = {
  component: RouteComponent;
} & MenuInfo;
